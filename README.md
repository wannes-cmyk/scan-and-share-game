# Live Quiz — scan & share

Een live quizspel voor een zaal, in de huisstijl van **AI wann.es**. Eén groot scherm
(host) toont een QR-code; deelnemers scannen die met hun gsm, komen in een lobby en spelen
samen. Op het einde krijgt elke speler een persoonlijke, deelbare Story-kaart (1080×1920).

- **Live:** https://play.wann.es
- **Host-scherm:** https://play.wann.es/host.html
- **Beheer (vragen + instellingen):** https://play.wann.es/admin.html
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

## Branding en stijl

De huisstijl van **AI wann.es** zit overal: het logo (avatar) in een accentchip, de naam
"AI wann.es", het accent **#FAC213**, de steunkleur **#EA5758** en het font **Montserrat**.
Dat staat ook op de eindkaart.

Er zijn twee stijlen, te wisselen in de admin:

- **AI wann.es** — de standaardstijl (donker, geel accent, Montserrat).
- **Punk** — zwart/wit/rood, geen ronde hoeken, dikke randen, monospace, alles in kapitalen.

De gekozen stijl staat in Supabase en wordt **live** toegepast: als je hem in de admin
omzet, verandert het host- en spelerscherm meteen mee.

## Bestanden

```
index.html                        startscherm: host of speler
host.html                         groot scherm (projector)
play.html                         speler-scherm (gsm)
admin.html                        beheer: instellingen, import, vragen
style.css                         beide thema's + branding
assets/logo.webp                  het AI wann.es-logo
templates/voorbeeld-vragen.csv    voorbeeldbestand om te importeren
templates/voorbeeld-vragen.md     voorbeeldbestand om te importeren
js/config.js                      Supabase-URL + anon key + terugvalwaarden
js/brand.js                       laadt de config en past de branding toe
js/supabase-client.js             Supabase-client + HTML-escape helper
js/card.js                        eindkaart-generator (canvas)
js/host.js                        host-logica
js/play.js                        speler-logica
js/admin.js                       beheer-logica
supabase/install-all.sql                ALLE migraties in volgorde — dit run je in de SQL-editor
supabase/verify.sql                     controle: is alles toegepast?
supabase/migrations/0001_init.sql         schema, RLS, RPC's, realtime
supabase/migrations/0002_seed.sql         host-key + de startvragen
supabase/migrations/0003_admin.sql        RPC's voor het beheren van vragen
supabase/migrations/0004_config_import.sql  config + bulk-import
.github/workflows/pages.yml       deploy naar GitHub Pages
CNAME                             play.wann.es
```

## Een quiz geven (dagelijks gebruik)

1. Open **https://play.wann.es/host.html** op de laptop die aan de projector hangt.
2. Voer eenmalig de **host-key** in (die wordt lokaal onthouden).
3. Het scherm toont een QR-code en een 4-cijferige code. Deel die met de zaal.
4. Wacht tot iedereen in de lobby staat → **Start spel**.
5. Per vraag: spelers antwoorden → **Toon antwoord** (juiste antwoord, de duiding en een
   staafdiagram van wat de zaal koos) → **Volgende vraag**.
6. Op het einde: **Eindstand**. Elke speler krijgt op zijn gsm een persoonlijke kaart om
   te downloaden of te delen.
7. **Nieuw spel** maakt een nieuwe room; je kan meteen opnieuw beginnen.

De host speelt zelf niet mee. **Spelers zien hun score niet tijdens het spel** — alleen
"juist/helaas" — en pas op het einde hun totaalscore en positie.

## Beheer: https://play.wann.es/admin.html

Voer dezelfde host-key in als op het host-scherm.

### Spelinstellingen

- **Tijd per vraag** — het aantal seconden dat spelers hebben (5 tot 300).
- **Titel** — de titel die op de eindkaart verschijnt.
- **Stijl** — de schakelaar tussen **AI wann.es** en **Punk**.

Klik **Instellingen opslaan**. Wijzigingen gelden meteen (ook voor een lopend spel).

### Vragen importeren

Kies of sleep een bestand in het importvak. Ondersteund: **CSV**, **Excel (.xlsx)** en
**Markdown**. Je krijgt eerst een voorbeeld te zien, en kiest dan of je de vragen
**toevoegt** aan de bestaande of ze **vervangt**.

**CSV / Excel** — kolommen (met of zonder kopregel):

```
vraag, a, b, c, d, juist, uitleg
```

`juist` is **A/B/C/D** of **1-4**. Met een kopregel mag je ook 2 tot 6 antwoordkolommen
gebruiken (de kolommen tussen "vraag" en "juist" tellen als antwoorden).

**Markdown**:

```
## De vraagtekst?

- [ ] Antwoord A
- [x] Antwoord B      <- het juiste
- [ ] Antwoord C
- [ ] Antwoord D

> De duiding die verschijnt bij het juiste antwoord.
```

Voorbeelden staan in `templates/` (er zijn downloadlinks in de admin).

### Vragen beheren

- **Bewerken:** typ in de velden en klik **Opslaan**.
- **Het juiste antwoord:** vink het bolletje aan. Dit is wat de spelers *niet* te zien krijgen.
- **Duiding:** de extra tekst die verschijnt wanneer het juiste antwoord wordt getoond —
  zowel op het host-scherm als op de gsm van elke speler.
- **Volgorde:** de ↑ / ↓ knoppen. De volgorde hier is de volgorde in het spel.
- **Toevoegen / verwijderen:** de knoppen onderaan en op elke kaart.

Er zijn 4 antwoordopties per vraag in het beheerscherm (het spel gaat daarvan uit).

### Peilingen (vragen zonder juist antwoord)

Vink **"Peiling — geen juist antwoord"** aan bij een vraag, en de vraag krijgt geen goed
antwoord. De deelnemers antwoorden gewoon, er worden **geen punten** gegeven, en bij het
onthullen zie je de **verdeling**: hoeveel deelnemers welke optie kozen, in balkjes met
percentages. Dat is het startpunt van de discussie.

Bij een gewone vraag zie je die verdeling trouwens ook — het juiste antwoord krijgt dan een
groene balk met een ✓. De deelnemers zien de verdeling op hun gsm ook.

**Bij import:** laat je het `juist`-veld leeg (of zet je nergens een `[x]` in Markdown), dan
wordt die vraag een peiling. Je krijgt bij de preview te zien hoeveel dat er zijn.

### De verdeling op het grote scherm

Na het onthullen staat onder de vraag: *"X van Y spelers koos"*, met per optie een balk, het
aantal en het percentage. Die balken **updaten live** — als er nog iemand antwoordt terwijl het
onthuld is, zie je dat meteen. Ideaal om te vragen "wie koos B, en waarom?"

### E-mailadressen

Na het spel kan elke deelnemer zijn e-mailadres achterlaten (met een expliciete
toestemmingsvink). Die adressen staan in de tabel `leads` en zijn **niet** leesbaar met de
anon key — enkel via `host_leads(host_key)`.

In het beheer, onderaan: **Laden** toont hoeveel adressen er zijn, **Download CSV** geeft een
bestand met datum, naam, e-mail, score en room — klaar om in je mailingtool te importeren.

**Antwoorden als PDF** in datzelfde paneel geeft de *neutrale* versie: alle vragen, het juiste
antwoord en de duiding, zonder naam of score. Die gebruik je als bijlage wanneer je de lijst
zelf aanschrijft.

### De handmatige weg (werkt vandaag)

1. Na het spel download je in het beheer de **CSV** met adressen en de **PDF** met antwoorden.
2. Je stuurt de PDF naar de lijst — via je eigen mailingtool, met de score uit de CSV in de tekst.
3. Klaar.

De deelnemer heeft de antwoorden trouwens ook meteen: na het spel ziet hij ze op zijn scherm en
kan hij ze zelf als PDF downloaden (met zijn eigen naam, score en positie erin).

Het automatisch *verzenden* zit er niet in. Wil je dat de deelnemer de PDF in zijn mailbox
krijgt zonder dat jij iets doet, dan vraagt dat een Supabase Edge Function plus een
e-mailprovider (bv. Resend, gratis tier). Dat is een aparte stap.

## De backend (Supabase)

**Opzetten of bijwerken:** plak de inhoud van `supabase/install-all.sql` in de SQL-editor en
run het. Dat bestand bevat alle migraties in de juiste volgorde en is idempotent — je mag het
gerust opnieuw draaien. Twijfel je of alles toegepast is? Run `supabase/verify.sql`: dat
toont per tabel en per functie of die bestaat.

Tabellen:

- `settings` — bevat de `host_key`. **Geen** anon-toegang.
- `questions` — de vragen. **Geen** anon-toegang; enkel via `get_questions(host_key)`.
- `game_config` — tijd, stijl, titel. **Wel** leesbaar voor anon (nodig voor de branding).
- `rooms` — de spelstatus per room. Leesbaar voor anon.
- `players` — spelers + scores. Leesbaar voor anon.
- `answers` — de antwoorden. Leesbaar voor anon (nodig voor het live staafdiagram).

RPC's:

- Spelers: `join_room`, `submit_answer` (berekent de score server-side).
- Host: `get_questions`, `host_create_room`, `host_set_question`, `host_reveal`,
  `host_set_state`, `host_delete_room`.
- Beheer: `host_save_question`, `host_delete_question`, `host_move_question`,
  `host_set_config`, `host_import_questions`.

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
  heeft geen SELECT-policy op dat tabel (Realtime respecteert RLS).
- **"ongeldige host key"** terwijl je de juiste typt → `settings.host_key` in Supabase wijkt
  af van wat je intypt (check de Table Editor).
- **Site toont "Site not found"** → de Pages-source staat niet op "GitHub Actions", of de
  laatste Action-run is gefaald (check het tabblad **Actions**).
- **QR-code of logo verschijnt niet** → die komen van esm.sh en uit `assets/`; controleer of
  `assets/logo.webp` meegedeployed is.
- **Import vindt geen vragen** → controleer de kolomnamen (`vraag`, `juist`, …) of gebruik
  het voorbeeldbestand uit `templates/`.

## Backend opnieuw opzetten (vanaf nul)

Zie `SUPABASE-SETUP.md` voor de volledige, stap-voor-stap opdracht (bruikbaar als prompt
voor een AI-agent).
