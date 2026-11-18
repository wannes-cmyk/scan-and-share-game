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
