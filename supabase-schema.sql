-- The CEO's Last Meeting — Supabase database setup
-- Run this entire file once in Supabase Dashboard -> SQL Editor.
-- It creates the game tables, RLS policies, secure RPC functions and Realtime publication entries.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists public.rooms (
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  host_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'game', 'results')),
  round smallint not null default 0 check (round between 0 and 2),
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  room_code text not null references public.rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  team smallint not null check (team between 0 and 4),
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_code, user_id),
  constraint host_team_consistency check (
    (is_host = true and team = 0) or
    (is_host = false and team between 1 and 4)
  )
);

create table if not exists public.submissions (
  room_code text not null,
  user_id uuid not null,
  round smallint not null check (round between 0 and 2),
  answer text not null check (answer in ('A', 'B', 'C', 'D')),
  points integer not null default 0 check (points in (0, 100, 150)),
  correct boolean not null default false,
  idea text not null default '' check (char_length(idea) <= 240),
  player_name text not null,
  team smallint not null check (team between 1 and 4),
  created_at timestamptz not null default now(),
  primary key (room_code, user_id, round),
  foreign key (room_code, user_id)
    references public.players(room_code, user_id)
    on delete cascade
);

create index if not exists rooms_host_id_idx on public.rooms(host_id);
create index if not exists players_user_id_idx on public.players(user_id);
create index if not exists submissions_user_id_idx on public.submissions(user_id);
create index if not exists submissions_room_round_idx on public.submissions(room_code, round);

-- Security-definer helper prevents recursive RLS checks when determining room membership.
create or replace function private.is_room_member(p_room_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.players p
    where p.room_code = p_room_code
      and p.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_room_member(text) from public;
grant execute on function private.is_room_member(text) to authenticated;

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.submissions enable row level security;

-- Explicit grants: browser clients may read their joined rooms and only hosts may update room state.
-- Inserts into rooms/players/submissions happen only through the security-definer RPCs below.
revoke all on table public.rooms from anon, authenticated;
revoke all on table public.players from anon, authenticated;
revoke all on table public.submissions from anon, authenticated;

grant select on table public.rooms to authenticated;
grant update (status, round) on table public.rooms to authenticated;
grant select on table public.players to authenticated;
grant select on table public.submissions to authenticated;

drop policy if exists "Room members can read rooms" on public.rooms;
create policy "Room members can read rooms"
on public.rooms
for select
to authenticated
using (
  host_id = (select auth.uid())
  or private.is_room_member(code)
);

drop policy if exists "Only hosts can update rooms" on public.rooms;
create policy "Only hosts can update rooms"
on public.rooms
for update
to authenticated
using (host_id = (select auth.uid()))
with check (host_id = (select auth.uid()));

drop policy if exists "Room members can read players" on public.players;
create policy "Room members can read players"
on public.players
for select
to authenticated
using (private.is_room_member(room_code));

drop policy if exists "Room members can read submissions" on public.submissions;
create policy "Room members can read submissions"
on public.submissions
for select
to authenticated
using (private.is_room_member(room_code));

-- Host room creation. The function performs the room + host-player insert together.
create or replace function public.create_game_room(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(trim(p_code));
begin
  if v_uid is null then
    raise exception 'GAME_ERROR: You must be signed in.';
  end if;

  if v_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception 'GAME_ERROR: Invalid room code.';
  end if;

  insert into public.rooms (code, host_id, status, round)
  values (v_code, v_uid, 'lobby', 0);

  insert into public.players (room_code, user_id, name, team, is_host)
  values (v_code, v_uid, 'HOST', 0, true);

  return v_code;
end;
$$;

revoke all on function public.create_game_room(text) from public;
grant execute on function public.create_game_room(text) to authenticated;

-- Students join by room code. The room row is locked while assigning a team so
-- simultaneous joins cannot all receive the same team from a stale player count.
create or replace function public.join_game_room(p_room_code text, p_name text)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(trim(p_room_code));
  v_name text := trim(p_name);
  v_status text;
  v_team smallint;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'GAME_ERROR: You must be signed in.';
  end if;

  if v_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
    raise exception 'GAME_ERROR: Invalid room code.';
  end if;

  if v_name is null or char_length(v_name) < 1 or char_length(v_name) > 24 then
    raise exception 'GAME_ERROR: Enter a name between 1 and 24 characters.';
  end if;

  select r.status
  into v_status
  from public.rooms r
  where r.code = v_code
  for update;

  if not found then
    raise exception 'GAME_ERROR: Room not found.';
  end if;

  -- Rejoining from the same browser/session is allowed, even if the game started.
  select p.team
  into v_team
  from public.players p
  where p.room_code = v_code
    and p.user_id = v_uid;

  if found then
    update public.players
    set name = case when is_host then name else v_name end
    where room_code = v_code and user_id = v_uid;
    return v_team;
  end if;

  if v_status <> 'lobby' then
    raise exception 'GAME_ERROR: That mission has already started.';
  end if;

  select count(*)
  into v_count
  from public.players p
  where p.room_code = v_code
    and p.is_host = false;

  v_team := ((v_count % 4) + 1)::smallint;

  insert into public.players (room_code, user_id, name, team, is_host)
  values (v_code, v_uid, v_name, v_team, false);

  return v_team;
end;
$$;

revoke all on function public.join_game_room(text, text) from public;
grant execute on function public.join_game_room(text, text) to authenticated;

-- Server-side scoring. Students submit only their answer/idea; points and
-- correctness are calculated in Postgres, so browser users cannot award themselves points.
create or replace function public.submit_game_answer(
  p_room_code text,
  p_round smallint,
  p_answer text,
  p_idea text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(trim(p_room_code));
  v_answer text := upper(trim(p_answer));
  v_idea text := trim(coalesce(p_idea, ''));
  v_status text;
  v_current_round smallint;
  v_name text;
  v_team smallint;
  v_is_host boolean;
  v_correct boolean;
  v_points integer;
begin
  if v_uid is null then
    raise exception 'GAME_ERROR: You must be signed in.';
  end if;

  if p_round not between 0 and 2 then
    raise exception 'GAME_ERROR: Invalid round.';
  end if;

  if v_answer not in ('A', 'B', 'C', 'D') then
    raise exception 'GAME_ERROR: Invalid answer.';
  end if;

  select r.status, r.round
  into v_status, v_current_round
  from public.rooms r
  where r.code = v_code
  for update;

  if not found then
    raise exception 'GAME_ERROR: Room not found.';
  end if;

  if v_status <> 'game' then
    raise exception 'GAME_ERROR: The game is not accepting answers.';
  end if;

  if v_current_round <> p_round then
    raise exception 'GAME_ERROR: That round is no longer active.';
  end if;

  select p.name, p.team, p.is_host
  into v_name, v_team, v_is_host
  from public.players p
  where p.room_code = v_code
    and p.user_id = v_uid;

  if not found then
    raise exception 'GAME_ERROR: Join the room before submitting.';
  end if;

  if v_is_host then
    raise exception 'GAME_ERROR: The host does not submit team answers.';
  end if;

  if p_round = 0 then
    v_correct := (v_answer = 'B');
    v_points := case when v_correct then 100 else 0 end;
  elsif p_round = 1 then
    v_correct := (v_answer = 'A');
    v_points := case when v_correct then 100 else 0 end;
  else
    if v_answer not in ('A', 'B', 'C') then
      raise exception 'GAME_ERROR: Invalid innovation choice.';
    end if;
    if char_length(v_idea) < 1 or char_length(v_idea) > 240 then
      raise exception 'GAME_ERROR: Write an innovation between 1 and 240 characters.';
    end if;
    v_correct := true;
    v_points := 150;
  end if;

  insert into public.submissions (
    room_code, user_id, round, answer, points, correct,
    idea, player_name, team
  ) values (
    v_code, v_uid, p_round, v_answer, v_points, v_correct,
    case when p_round = 2 then v_idea else '' end,
    v_name, v_team
  );

exception
  when unique_violation then
    raise exception 'GAME_ERROR: You already submitted this round.';
end;
$$;

revoke all on function public.submit_game_answer(text, smallint, text, text) from public;
grant execute on function public.submit_game_answer(text, smallint, text, text) to authenticated;

-- Enable Postgres Changes for the three game tables.
do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.players;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.submissions;
exception when duplicate_object then null;
end $$;
