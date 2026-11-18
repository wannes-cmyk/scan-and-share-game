-- ============================================================
-- Live Quiz — ALLE migraties, in volgorde.
-- Plak dit volledige bestand in de Supabase SQL-editor en run het.
-- Alles is idempotent: je mag dit gerust opnieuw draaien.
-- ============================================================

-- ============================================================
-- >>> migrations/0001_init.sql
-- ============================================================
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

-- Tabelrechten: RLS regelt de rijen, maar anon heeft ook tabeltoegang nodig.
-- (Supabase geeft dit standaard, maar expliciet is veiliger.)
grant select on rooms, players, answers to anon;

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

-- ============================================================
-- >>> migrations/0002_seed.sql
-- ============================================================
-- Seed: host-key + 5 vragen. Pas aan naar wens.
-- De host-key is het geheime wachtwoord dat de host eenmalig intypt.
-- Herinnering: een apostrof in SQL-tekst schrijf je als twee apostroffen ('').

insert into settings (key, value)
values ('host_key', 'KIES-EEN-LANGE-RANDOM-STRING-hier')
on conflict (key) do nothing;   -- laat een bestaande (echte) host-key met rust

insert into questions (idx, vraag, opties, juist, uitleg) values
  (1, 'Hoeveel procent van je werk denk je dat AI binnen 2 jaar overneemt?',
      '["Minder dan 10%", "10 tot 30%", "30 tot 60%", "Meer dan 60%"]'::jsonb, 2,
      'De meningen lopen sterk uiteen - daarom is dit een goede discussiestarter.'),
  (2, 'Wat kan een taalmodel vandaag het BEST?',
      '["Feilloos rekenen", "Tekst samenvatten en herschrijven", "De toekomst voorspellen", "Zelfstandig beslissingen nemen"]'::jsonb, 1,
      'Samenvatten en herschrijven is waar het uitblinkt; rekenen en voorspellen blijven zwak.'),
  (3, 'Wie is het snelst met een complexe spreadsheet-formule?',
      '["De expert", "De stagiair", "AI", "Maakt niet uit"]'::jsonb, 2,
      'Dit is de kern: AI verslaat de expert op snelheid, niet altijd op oordeel.'),
  (4, 'Wat is het grootste risico van AI-output zonder controle?',
      '["Het is te duur", "Het klinkt overtuigend maar kan fout zijn", "Het is te traag", "Het kan niet in het Nederlands"]'::jsonb, 1,
      'Hallucinaties zijn gevaarlijk omdat ze zelfverzekerd klinken.'),
  (5, 'Wat blijft het meest waardevol in een AI-tijdperk?',
      '["Snel typen", "Kennis uit het hoofd", "Beslissen wat juist is", "Excel kunnen"]'::jsonb, 2,
      'Het oordeel - weten wat je moet vertrouwen - wordt schaarser en dus waardevoller.')
on conflict (idx) do nothing;

-- ============================================================
-- >>> migrations/0003_admin.sql
-- ============================================================
-- Admin: vragen beheren via de host-key. Idempotent.
-- Voegt RPC's toe voor het beheren van vragen vanuit admin.html.
-- De vragen blijven in Supabase (nooit in de client); de host-key gate't alles.

create or replace function host_save_question(
  p_host_key text,
  p_id       int,
  p_idx      int,
  p_vraag    text,
  p_opties   jsonb,
  p_juist    int,
  p_uitleg   text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  int;
  v_idx int;
begin
  perform _check_host_key(p_host_key);

  if coalesce(btrim(p_vraag), '') = '' then
    raise exception 'de vraag mag niet leeg zijn';
  end if;
  if p_opties is null or jsonb_typeof(p_opties) <> 'array' or jsonb_array_length(p_opties) < 2 then
    raise exception 'minstens 2 antwoordopties nodig';
  end if;
  if p_juist is null or p_juist < 0 or p_juist >= jsonb_array_length(p_opties) then
    raise exception 'het juiste antwoord valt buiten de opties';
  end if;

  if p_id is null then
    -- nieuwe vraag: achteraan toevoegen tenzij een idx is meegegeven
    v_idx := coalesce(p_idx, (select coalesce(max(idx), 0) + 1 from questions));
    insert into questions (idx, vraag, opties, juist, uitleg)
    values (v_idx, btrim(p_vraag), p_opties, p_juist, nullif(btrim(coalesce(p_uitleg, '')), ''))
    returning id into v_id;
  else
    v_idx := coalesce(p_idx, (select idx from questions where id = p_id));
    update questions
       set idx    = v_idx,
           vraag  = btrim(p_vraag),
           opties = p_opties,
           juist  = p_juist,
           uitleg = nullif(btrim(coalesce(p_uitleg, '')), '')
     where id = p_id
     returning id into v_id;
    if v_id is null then
      raise exception 'vraag niet gevonden';
    end if;
  end if;

  return v_id;
end $$;

create or replace function host_delete_question(p_host_key text, p_id int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _check_host_key(p_host_key);
  delete from questions where id = p_id;
end $$;

-- Verplaats een vraag een plaats omhoog (p_dir < 0) of omlaag (p_dir > 0).
-- Wisselt de idx-waarden via een tijdelijke waarde, zodat de unieke idx niet botst.
create or replace function host_move_question(p_host_key text, p_id int, p_dir int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idx   int;
  v_other int;
  v_tmp   int;
begin
  perform _check_host_key(p_host_key);

  select idx into v_idx from questions where id = p_id;
  if v_idx is null then
    raise exception 'vraag niet gevonden';
  end if;

  if p_dir < 0 then
    select idx into v_other from questions where idx < v_idx order by idx desc limit 1;
  else
    select idx into v_other from questions where idx > v_idx order by idx asc limit 1;
  end if;

  if v_other is null then
    return;  -- staat al aan de rand
  end if;

  select coalesce(min(idx), 1) - 1 into v_tmp from questions;
  update questions set idx = v_tmp   where idx = v_idx;
  update questions set idx = v_idx   where idx = v_other;
  update questions set idx = v_other where idx = v_tmp;
end $$;

grant execute on function host_save_question(text, int, int, text, jsonb, int, text) to anon;
grant execute on function host_delete_question(text, int)                            to anon;
grant execute on function host_move_question(text, int, int)                          to anon;

-- ============================================================
-- >>> migrations/0004_config_import.sql
-- ============================================================
-- Config (tijd, thema, titel) + bulk-import van vragen. Idempotent.

-- ---------- game_config: één rij, publiek leesbaar ----------

create table if not exists game_config (
  id             int  primary key default 1,
  answer_seconds int  not null default 20,
  theme          text not null default 'wannes',
  game_title     text not null default 'AI kills the expert — live quiz',
  accent         text not null default '#FAC213',
  updated_at     timestamptz not null default now(),
  constraint game_config_single_row check (id = 1)
);

insert into game_config (id) values (1) on conflict (id) do nothing;

alter table game_config enable row level security;
drop policy if exists game_config_read on game_config;
create policy game_config_read on game_config for select to anon using (true);
grant select on game_config to anon;

do $$ begin
  begin alter publication supabase_realtime add table game_config;
  exception when duplicate_object then null; end;
end $$;

-- ---------- host_reveal: geef de duiding mee aan de spelers ----------

create or replace function host_reveal(p_host_key text, p_room_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idx     int;
  v_correct int;
  v_uitleg  text;
begin
  perform _check_host_key(p_host_key);
  select question_index into v_idx from rooms where id = p_room_id;
  select juist, uitleg into v_correct, v_uitleg from questions where idx = v_idx;
  update rooms
     set state         = 'reveal',
         correct_index = v_correct,
         question      = coalesce(question, '{}'::jsonb)
                         || jsonb_build_object('uitleg', coalesce(v_uitleg, ''))
   where id = p_room_id;
end $$;

-- ---------- host_set_question: val terug op de ingestelde tijd ----------

create or replace function host_set_question(
  p_host_key text, p_room_id text, p_index int, p_seconds int default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q      questions%rowtype;
  v_secs int;
begin
  perform _check_host_key(p_host_key);
  select * into q from questions where idx = p_index;
  if not found then
    raise exception 'vraag % niet gevonden', p_index;
  end if;

  v_secs := greatest(5, coalesce(p_seconds, (select answer_seconds from game_config where id = 1), 20));

  update rooms set
    state          = 'question',
    question_index = p_index,
    question       = jsonb_build_object('vraag', q.vraag, 'opties', q.opties),
    correct_index  = null,
    started_at     = now(),
    deadline       = now() + make_interval(secs => v_secs)
  where id = p_room_id;
end $$;

-- ---------- Config schrijven ----------

create or replace function host_set_config(
  p_host_key       text,
  p_answer_seconds int,
  p_theme          text,
  p_game_title     text,
  p_accent         text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _check_host_key(p_host_key);

  if p_answer_seconds is not null and (p_answer_seconds < 5 or p_answer_seconds > 300) then
    raise exception 'de tijd moet tussen 5 en 300 seconden liggen';
  end if;
  if p_theme is not null and p_theme not in ('wannes', 'punk') then
    raise exception 'onbekend thema: %', p_theme;
  end if;

  update game_config set
    answer_seconds = coalesce(p_answer_seconds, answer_seconds),
    theme          = coalesce(p_theme, theme),
    game_title     = coalesce(nullif(btrim(coalesce(p_game_title, '')), ''), game_title),
    accent         = coalesce(nullif(btrim(coalesce(p_accent, '')), ''), accent),
    updated_at     = now()
  where id = 1;
end $$;

-- ---------- Bulk-import van vragen ----------
-- p_questions: jsonb-array van { vraag, opties[], juist, uitleg }

create or replace function host_import_questions(
  p_host_key  text,
  p_questions jsonb,
  p_replace   boolean default false
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start int;
  q       jsonb;
  i       int := 0;
  v_opts  jsonb;
  v_juist int;
  v_vraag text;
begin
  perform _check_host_key(p_host_key);

  if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'geen vragen om te importeren';
  end if;

  if p_replace then
    delete from questions;
    v_start := 0;
  else
    select coalesce(max(idx), 0) into v_start from questions;
  end if;

  for q in select * from jsonb_array_elements(p_questions) loop
    i := i + 1;
    v_vraag := btrim(coalesce(q->>'vraag', ''));
    v_opts  := q->'opties';
    v_juist := coalesce((q->>'juist')::int, -1);

    if v_vraag = '' then
      raise exception 'vraag % heeft geen tekst', i;
    end if;
    if v_opts is null or jsonb_typeof(v_opts) <> 'array' or jsonb_array_length(v_opts) < 2 then
      raise exception 'vraag % heeft minder dan 2 antwoorden', i;
    end if;
    if v_juist < 0 or v_juist >= jsonb_array_length(v_opts) then
      raise exception 'vraag % heeft geen geldig juist antwoord', i;
    end if;

    insert into questions (idx, vraag, opties, juist, uitleg)
    values (
      v_start + i,
      v_vraag,
      v_opts,
      v_juist,
      nullif(btrim(coalesce(q->>'uitleg', '')), '')
    );
  end loop;

  return i;
end $$;

grant execute on function host_set_config(text, int, text, text, text) to anon;
grant execute on function host_import_questions(text, jsonb, boolean)   to anon;

-- ============================================================
-- >>> migrations/0005_answers_leads.sql
-- ============================================================
-- Na het spel: antwoorden vrijgeven + e-mailadressen vastleggen. Idempotent.

-- ---------- leads: enkel via RPC, nooit leesbaar voor anon ----------

create table if not exists leads (
  id         uuid primary key default gen_random_uuid(),
  room_id    text,
  player_id  uuid,
  name       text,
  email      text not null,
  score      int,
  consent    boolean not null default false,
  source     text not null default 'quiz',
  created_at timestamptz not null default now()
);

alter table leads enable row level security;
-- Bewust GEEN policy: anon kan de lijst niet lezen. Insert gaat via register_lead().

-- ---------- Antwoorden: pas nadat het spel gedaan is ----------

create or replace function get_answers(p_room_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_out   jsonb;
begin
  select state into v_state from rooms where id = p_room_id;
  if v_state is null then
    raise exception 'room niet gevonden';
  end if;
  if v_state <> 'end' then
    raise exception 'het spel is nog bezig';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'idx', idx, 'vraag', vraag, 'opties', opties,
               'juist', juist, 'uitleg', uitleg
             ) order by idx
           ), '[]'::jsonb)
    into v_out
    from questions;

  return v_out;
end $$;

-- ---------- E-mailadres vastleggen ----------

create or replace function register_lead(
  p_room_id   text,
  p_player_id uuid,
  p_email     text,
  p_consent   boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text;
  v_score int;
  v_email text;
begin
  v_email := lower(btrim(coalesce(p_email, '')));

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'dat lijkt geen geldig e-mailadres';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'vink eerst het vakje aan';
  end if;

  -- al geregistreerd voor dit spel? dan niets doen
  if p_player_id is not null
     and exists (select 1 from leads where room_id = p_room_id and player_id = p_player_id) then
    return;
  end if;

  select name, score into v_name, v_score from players where id = p_player_id;

  insert into leads (room_id, player_id, name, email, score, consent)
  values (p_room_id, p_player_id, v_name, v_email, v_score, true);
end $$;

-- ---------- Host: de lijst ophalen ----------

create or replace function host_leads(p_host_key text)
returns setof leads
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _check_host_key(p_host_key);
  return query select * from leads order by created_at desc;
end $$;

grant execute on function get_answers(text)                        to anon;
grant execute on function register_lead(text, uuid, text, boolean) to anon;
grant execute on function host_leads(text)                         to anon;

-- ============================================================
-- >>> migrations/0006_polls.sql
-- ============================================================
-- Peilingsvragen: een vraag zonder juist antwoord, voor groepsdiscussie. Idempotent.
-- Zo'n vraag geeft geen punten, maar toont wel de spreiding van de antwoorden.

-- ---------- juist mag leeg zijn ----------

alter table questions alter column juist drop not null;

alter table questions drop constraint if exists questions_juist_range;
alter table questions add constraint questions_juist_range
  check (juist is null or juist >= 0);

-- ---------- host_save_question: juist mag null zijn ----------

create or replace function host_save_question(
  p_host_key text,
  p_id       int,
  p_idx      int,
  p_vraag    text,
  p_opties   jsonb,
  p_juist    int,
  p_uitleg   text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  int;
  v_idx int;
begin
  perform _check_host_key(p_host_key);

  if coalesce(btrim(p_vraag), '') = '' then
    raise exception 'de vraag mag niet leeg zijn';
  end if;
  if p_opties is null or jsonb_typeof(p_opties) <> 'array' or jsonb_array_length(p_opties) < 2 then
    raise exception 'minstens 2 antwoordopties nodig';
  end if;
  -- p_juist = null betekent: peiling, geen juist antwoord
  if p_juist is not null and (p_juist < 0 or p_juist >= jsonb_array_length(p_opties)) then
    raise exception 'het juiste antwoord valt buiten de opties';
  end if;

  if p_id is null then
    v_idx := coalesce(p_idx, (select coalesce(max(idx), 0) + 1 from questions));
    insert into questions (idx, vraag, opties, juist, uitleg)
    values (v_idx, btrim(p_vraag), p_opties, p_juist, nullif(btrim(coalesce(p_uitleg, '')), ''))
    returning id into v_id;
  else
    v_idx := coalesce(p_idx, (select idx from questions where id = p_id));
    update questions
       set idx    = v_idx,
           vraag  = btrim(p_vraag),
           opties = p_opties,
           juist  = p_juist,
           uitleg = nullif(btrim(coalesce(p_uitleg, '')), '')
     where id = p_id
     returning id into v_id;
    if v_id is null then
      raise exception 'vraag niet gevonden';
    end if;
  end if;

  return v_id;
end $$;

-- ---------- host_import_questions: leeg 'juist' wordt een peiling ----------

create or replace function host_import_questions(
  p_host_key  text,
  p_questions jsonb,
  p_replace   boolean default false
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start int;
  q       jsonb;
  i       int := 0;
  v_opts  jsonb;
  v_juist int;
  v_vraag text;
begin
  perform _check_host_key(p_host_key);

  if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'geen vragen om te importeren';
  end if;

  if p_replace then
    delete from questions;
    v_start := 0;
  else
    select coalesce(max(idx), 0) into v_start from questions;
  end if;

  for q in select * from jsonb_array_elements(p_questions) loop
    i := i + 1;
    v_vraag := btrim(coalesce(q->>'vraag', ''));
    v_opts  := q->'opties';
    -- leeg, ontbrekend of null -> peiling (geen juist antwoord)
    v_juist := nullif(btrim(coalesce(q->>'juist', '')), '')::int;

    if v_vraag = '' then
      raise exception 'vraag % heeft geen tekst', i;
    end if;
    if v_opts is null or jsonb_typeof(v_opts) <> 'array' or jsonb_array_length(v_opts) < 2 then
      raise exception 'vraag % heeft minder dan 2 antwoorden', i;
    end if;
    if v_juist is not null and (v_juist < 0 or v_juist >= jsonb_array_length(v_opts)) then
      raise exception 'vraag % heeft geen geldig juist antwoord', i;
    end if;

    insert into questions (idx, vraag, opties, juist, uitleg)
    values (
      v_start + i,
      v_vraag,
      v_opts,
      v_juist,
      nullif(btrim(coalesce(q->>'uitleg', '')), '')
    );
  end loop;

  return i;
end $$;

-- ---------- submit_answer: een peiling geeft geen punten ----------

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

  if not exists (select 1 from questions where idx = p_question_index) then
    raise exception 'vraag niet gevonden';
  end if;
  select juist into v_correct from questions where idx = p_question_index;

  v_ms       := floor(extract(epoch from (now() - r.started_at)) * 1000)::int;
  v_total_ms := greatest(1, floor(extract(epoch from (r.deadline - r.started_at)) * 1000)::int);

  -- Peiling: geen juist antwoord, dus geen punten. Antwoord wordt wel geregistreerd.
  if v_correct is not null and p_choice = v_correct then
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

