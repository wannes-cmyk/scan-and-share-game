-- Live Quiz — schema, RLS, RPC's en realtime
-- Plak dit in de Supabase SQL-editor (of run als migratie).
-- Idempotent: veilig om opnieuw te draaien.

create extension if not exists pgcrypto;

-- ---------- Tabellen ----------

create table if not exists settings (
  key   text primary key,
  value text not null
);

create table if not exists questions (
  id     serial primary key,
  idx    int  not null unique,
  vraag  text not null,
  opties jsonb not null,
  juist  int  not null,
  uitleg text
);

create table if not exists rooms (
  id             text primary key,
  state          text not null default 'lobby',
  question_index int,
  question       jsonb,
  correct_index  int,
  started_at     timestamptz,
  deadline       timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists players (
  id        uuid primary key default gen_random_uuid(),
  room_id   text not null references rooms(id) on delete cascade,
  name      text not null,
  score     int  not null default 0,
  joined_at timestamptz not null default now()
);

create table if not exists answers (
  id             uuid primary key default gen_random_uuid(),
  room_id        text not null,
  player_id      uuid not null,
  question_index int  not null,
  choice         int  not null,
  ms             int,
  created_at     timestamptz not null default now(),
  unique (room_id, player_id, question_index)
);

-- ---------- Realtime ----------

do $$
begin
  begin
    alter publication supabase_realtime add table rooms;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table players;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table answers;
  exception when duplicate_object then null; end;
end $$;

-- ---------- RLS ----------

alter table settings  enable row level security;
alter table questions enable row level security;
alter table rooms     enable row level security;
alter table players   enable row level security;
alter table answers   enable row level security;

-- Anon mag enkel lezen: rooms, players, answers. (settings + questions: niets.)
drop policy if exists rooms_read   on rooms;
drop policy if exists players_read on players;
drop policy if exists answers_read on answers;

create policy rooms_read   on rooms   for select to anon using (true);
create policy players_read on players for select to anon using (true);
create policy answers_read on answers for select to anon using (true);

-- ---------- Helper: host-key check ----------

create or replace function _check_host_key(p_host_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_host_key is null or p_host_key = '' then
    raise exception 'host key ontbreekt';
  end if;
  if not exists (select 1 from settings where key = 'host_key' and value = p_host_key) then
    raise exception 'ongeldige host key';
  end if;
end $$;

-- ---------- Speler-RPC's ----------

create or replace function join_room(p_room_id text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not exists (select 1 from rooms where id = p_room_id) then
    raise exception 'room niet gevonden';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'naam verplicht';
  end if;
  insert into players (room_id, name)
  values (p_room_id, left(btrim(p_name), 24))
  returning id into v_id;
  return v_id;
end $$;

create or replace function submit_answer(
  p_room_id text, p_player_id uuid, p_question_index int, p_choice int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r            rooms%rowtype;
  v_ms         int;
  v_total_ms   int;
  v_correct    int;
  v_points     int;
  v_remaining  numeric;
begin
  select * into r from rooms where id = p_room_id;
  if not found then raise exception 'room niet gevonden'; end if;

  if r.state <> 'question' or r.question_index is distinct from p_question_index then
    raise exception 'antwoorden niet open';
  end if;
  if now() > r.deadline then
    raise exception 'te laat';
  end if;

  select juist into v_correct from questions where idx = p_question_index;
  if v_correct is null then raise exception 'vraag niet gevonden'; end if;

  v_ms       := floor(extract(epoch from (now() - r.started_at)) * 1000)::int;
  v_total_ms := greatest(1, floor(extract(epoch from (r.deadline - r.started_at)) * 1000)::int);

  if p_choice = v_correct then
    v_remaining := greatest(0, 1 - (v_ms::numeric / v_total_ms));
    v_points    := 1000 + round(500 * v_remaining)::int;
  else
    v_points := 0;
  end if;

  insert into answers (room_id, player_id, question_index, choice, ms)
  values (p_room_id, p_player_id, p_question_index, p_choice, v_ms)
  on conflict (room_id, player_id, question_index) do nothing;

  if found then
    update players set score = score + v_points where id = p_player_id;
    return v_points;
  end if;
  return 0;  -- al geantwoord
end $$;

-- ---------- Host-RPC's ----------

create or replace function get_questions(p_host_key text)
returns setof questions
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _check_host_key(p_host_key);
  return query select * from questions order by idx;
end $$;

create or replace function host_create_room(p_host_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_code text;
begin
  perform _check_host_key(p_host_key);
  loop
    v_code := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from rooms where id = v_code);
  end loop;
  insert into rooms (id, state) values (v_code, 'lobby');
  return v_code;
end $$;

create or replace function host_set_question(
  p_host_key text, p_room_id text, p_index int, p_seconds int default 20
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare q questions%rowtype;
begin
  perform _check_host_key(p_host_key);
  select * into q from questions where idx = p_index;
  if not found then raise exception 'vraag % niet gevonden', p_index; end if;
  update rooms set
    state          = 'question',
    question_index = p_index,
    question       = jsonb_build_object('vraag', q.vraag, 'opties', q.opties),
    correct_index  = null,
    started_at     = now(),
    deadline       = now() + make_interval(secs => greatest(5, p_seconds))
  where id = p_room_id;
end $$;

create or replace function host_reveal(p_host_key text, p_room_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_idx int; v_correct int;
begin
  perform _check_host_key(p_host_key);
  select question_index into v_idx from rooms where id = p_room_id;
  select juist into v_correct from questions where idx = v_idx;
  update rooms set state = 'reveal', correct_index = v_correct where id = p_room_id;
end $$;

create or replace function host_set_state(p_host_key text, p_room_id text, p_state text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _check_host_key(p_host_key);
  if p_state not in ('lobby', 'question', 'reveal', 'leaderboard', 'end') then
    raise exception 'ongeldige state %', p_state;
  end if;
  update rooms set state = p_state where id = p_room_id;
end $$;

create or replace function host_delete_room(p_host_key text, p_room_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _check_host_key(p_host_key);
  delete from rooms where id = p_room_id;
end $$;

-- ---------- Rechten ----------

grant usage on schema public to anon;

grant execute on function join_room(text, text)                       to anon;
grant execute on function submit_answer(text, uuid, int, int)         to anon;
grant execute on function get_questions(text)                         to anon;
grant execute on function host_create_room(text)                      to anon;
grant execute on function host_set_question(text, text, int, int)     to anon;
grant execute on function host_reveal(text, text)                     to anon;
grant execute on function host_set_state(text, text, text)            to anon;
grant execute on function host_delete_room(text, text)                to anon;
