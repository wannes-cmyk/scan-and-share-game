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
