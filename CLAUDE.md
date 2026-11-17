# CLAUDE.md

## Project

`scan-and-share-game` — een statisch live-quizspel. Eén groot scherm (host) toont een
QR-code, deelnemers spelen mee op hun gsm. Backend op Supabase, gehost op GitHub Pages.
Zie `README.md` voor de opzet.

## Wat er nog moet gebeuren

**Zet de Supabase-backend op.** De volledige opdracht staat in **`SUPABASE-SETUP.md`** —
volg dat bestand stap voor stap.

## Regels

- Geen build step, geen framework: vanilla HTML/CSS/JS met de Supabase JS-client van
  `https://esm.sh/@supabase/supabase-js@2`.
- Geheimen en de juiste antwoorden horen **niet** in de client of de repo.
- Scores en host-acties horen in `security definer`-RPC's, **niet** in JavaScript.
- Wijzig de RLS- en `security definer`-opzet niet zonder reden (zie `SUPABASE-SETUP.md`,
  sectie "Ontwerpregels").
