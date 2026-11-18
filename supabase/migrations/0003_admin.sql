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
