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
