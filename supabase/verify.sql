-- Controle: is alles toegepast op deze Supabase?
-- Plak dit in de SQL-editor en run het. Bovenaan zie je wat ONTBREEKT (indien iets).
-- Draai daarna supabase/install-all.sql als er iets ontbreekt.

select 'tabel: ' || t as onderdeel,
       case when to_regclass('public.' || t) is null then 'ONTBREEKT' else 'ok' end as status
from (values
  ('settings'), ('questions'), ('rooms'), ('players'), ('answers'), ('game_config')
) as x(t)

union all

select 'functie: ' || v.fn,
       case when p.oid is null then 'ONTBREEKT' else 'ok' end
from (values
  ('_check_host_key'),
  ('join_room'),
  ('submit_answer'),
  ('get_questions'),
  ('host_create_room'),
  ('host_set_question'),
  ('host_reveal'),
  ('host_set_state'),
  ('host_delete_room'),
  ('host_save_question'),
  ('host_delete_question'),
  ('host_move_question'),
  ('host_set_config'),
  ('host_import_questions')
) as v(fn)
left join pg_proc p on p.proname = v.fn

order by status, onderdeel;
