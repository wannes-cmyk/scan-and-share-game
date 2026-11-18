# Live Quiz — scan & share

Een live quizspel voor een zaal. Eén groot scherm (host) toont een QR-code; deelnemers
scannen die met hun gsm, komen in een lobby en spelen samen. Op het einde krijgt elke
speler een persoonlijke, deelbare Story-kaart (1080×1920 PNG).

- **Live:** https://play.wann.es
- **Host-scherm:** https://play.wann.es/host.html
- **Vragen beheren:** https://play.wann.es/admin.html
- **Spelers:** https://play.wann.es/play.html

## Hoe het werkt (in het kort)

- **Frontend:** statische HTML/CSS/JS, geen build step, geen framework. De Supabase-client
  komt van esm.sh.
- **Backend:** Supabase (Postgres + Realtime + RPC's). De frontend praat er rechtstreeks
  mee met de **anon key** — die is publiek en dat is de bedoeling.
- **Hosting:** GitHub Pages via een GitHub Action (`.github/workflows/pages.yml`).
- **Realtime:** spelers en host krijgen updates via Supabase Realtime (`postgres_changes`).
- **Beeld:** de eindkaart wordt volledig in de browser op een canvas getekend.

De veiligheid zit in twee dingen: **RLS** (wie mag welke rijen lezen) en
**`security definer`-functies** (alle schrijfacties lopen server-side, met eigen checks).
Er is geen eigen server.

## Bestanden

```
index.html                        startscherm: host of speler
host.html                         groot scherm (projector)
play.html                         speler-scherm (gsm)
admin.html                        vragen beheren
style.css
js/config.js                      Supabase-URL + anon key + spelinstellingen
js/supabase-client.js             Supabase-client + HTML-escape helper
js/card.js                        eindkaart-generator (canvas)
js/host.js                        host-logica
js/play.js                        speler-logica
js/admin.js                       vragen beheren
supabase/migrations/0001_init.sql    schema, RLS, RPC's, realtime
supabase/migrations/0002_seed.sql    host-key + de startvragen
supabase/migrations/0003_admin.sql   RPC's voor het beheren van vragen
.github/workflows/pages.yml          deploy naar GitHub Pages
CNAME                                play.wann.es
```

## Een quiz geven (dagelijks gebruik)

1. Open **https://play.wann.es/host.html** op de laptop die aan de projector hangt.
2. Voer eenmalig de **host-key** in (die wordt lokaal onthouden).
3. Het scherm toont een QR-code en een 4-cijferige code. Deel die met de zaal.
4. Wacht tot iedereen in de lobby staat → **Start spel**.
5. Per vraag: spelers antwoorden → **Toon antwoord** (juiste antwoord + staafdiagram) →
   **Volgende vraag**.
6. Op het einde: **Eindstand**. Elke speler krijgt op zijn gsm een persoonlijke kaart om
   te downloaden of te delen.
7. **Nieuw spel** maakt een nieuwe room; je kan meteen opnieuw beginnen.

De host speelt zelf niet mee.

## Vragen beheren

Ga naar **https://play.wann.es/admin.html** en voer dezelfde host-key in.

- **Bewerken:** typ in de velden en klik **Opslaan**.
- **Het juiste antwoord:** vink het bolletje naast het juiste antwoord aan. Dit is wat de
  spelers *niet* te zien krijgen.
- **Volgorde:** de ↑ / ↓ knoppen verplaatsen een vraag. De volgorde hier is de volgorde
  in het spel.
- **Toevoegen:** **+ Nieuwe vraag** onderaan.
- **Verwijderen:** de knop **Verwijderen** op de kaart.

Er zijn 4 antwoordopties per vraag (het spel gaat daarvan uit).

## Instellingen aanpassen

In `js/config.js`:

```js
export const GAME_TITLE = "AI kills the expert — live quiz";  // titel op de eindkaart
export const ACCENT = "#ffce00";        // accentkleur (score, knoppen, kaart)
export const ANSWER_SECONDS = 20;        // tijd per vraag
```

Na een aanpassing: committen en pushen → de Action zet de site automatisch opnieuw online.

## De backend (Supabase)

Tabellen:

- `settings` — bevat de `host_key`. **Geen** anon-toegang.
- `questions` — de vragen. **Geen** anon-toegang; enkel via `get_questions(host_key)`.
- `rooms` — de spelstatus per room. Leesbaar voor anon.
- `players` — spelers + scores. Leesbaar voor anon.
- `answers` — de antwoorden. Leesbaar voor anon (nodig voor het live staafdiagram).

RPC's:

- Spelers: `join_room`, `submit_answer` (berekent de score server-side).
- Host: `get_questions`, `host_create_room`, `host_set_question`, `host_reveal`,
  `host_set_state`, `host_delete_room`.
- Beheer: `host_save_question`, `host_delete_question`, `host_move_question`.

Elke `host_*`-functie controleert de host-key via `_check_host_key()`.

## Deployen

De site gaat automatisch online bij elke push naar `main`, via
`.github/workflows/pages.yml`.

Eenmalige instelling: **Settings → Pages → Source = "GitHub Actions"**. Het custom domein
`play.wann.es` staat in het `CNAME`-bestand en in Settings → Pages → Custom domain.

DNS: `play.wann.es` is een CNAME naar `wannes-cmyk.github.io`.

## Beveiliging — waarom het zo in elkaar zit

- **De anon key is publiek.** Iedereen kan hem zien. De veiligheid zit niet daarin, maar
  in RLS + `security definer`.
- **Spelers kunnen geen score vervalsen.** De punten worden berekend in `submit_answer`,
  op basis van de *servertijd* — niet in JavaScript.
- **De juiste antwoorden lekken niet.** Ze staan in `questions`, dat niet leesbaar is met
  de anon key. De host haalt ze op via `get_questions(host_key)`; spelers krijgen alleen
  wat de host in de room-rij schrijft, en `correct_index` komt pas vrij bij de reveal.
- **De host-key is het "wachtwoord" van de quizmaster.** Wie hem heeft, kan vragen beheren
  en spellen starten. Deel hem niet met de zaal.

## Als er iets niet werkt

- **"permission denied for table X"** bij anon → de `grant select` ontbreekt. Die staat in
  `0001_init.sql`.
- **Geen live updates** → de tabel staat niet in de `supabase_realtime`-publicatie, óf anon
  heeft geen SELECT-policy op die tabel (Realtime respecteert RLS).
- **"ongeldige host key"** terwijl je de juiste typt → `settings.host_key` in Supabase wijkt
  af van wat je intypt (check de Table Editor).
- **Site toont "Site not found"** → de Pages-source staat niet op "GitHub Actions", of de
  laatste Action-run is gefaald (check het tabblad **Actions**).
- **QR-code verschijnt niet** → de host-pagina laadt de QR-bibliotheek van esm.sh; check of
  het script-blok in `js/host.js` nog klopt.

## Backend opnieuw opzetten (vanaf nul)

Zie `SUPABASE-SETUP.md` voor de volledige, stap-voor-stap opdracht (bruikbaar als prompt
voor een AI-agent).
