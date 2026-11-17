# Live Quiz — scan & share

Een lokaal, gsm-gebaseerd live quizspel. Eén groot scherm (host) toont een QR-code,
deelnemers scannen die met hun gsm, komen in een lobby en spelen samen. Op het einde
krijgt elke deelnemer een persoonlijke, deelbare Story-kaart (1080×1920 PNG).

- **Backend:** Supabase (Postgres + Realtime + RPC's)
- **Frontend:** vanilla HTML/CSS/JS, geen build step
- **Hosting:** GitHub Pages

## Bestanden

```
index.html                     kies host of speler
host.html                      groot scherm (projector)
play.html                      speler-scherm (gsm)
style.css
js/config.js                   Supabase-URL + anon key + spelinstellingen
js/supabase-client.js          Supabase-client + helper
js/card.js                     eindkaart-generator (canvas)
js/host.js                     host-logica
js/play.js                     speler-logica
supabase/migrations/0001_init.sql   schema, RLS, RPC's, realtime
supabase/migrations/0002_seed.sql   host-key + 5 vragen
```

## Setup

### 1. Supabase-project

1. Maak een project aan op [supabase.com](https://supabase.com) (gratis tier volstaat).
2. Open de **SQL-editor** en run `supabase/migrations/0001_init.sql`.
3. Run daarna `supabase/migrations/0002_seed.sql`.
4. Pas in `0002_seed.sql` vóór het runnen de **host_key** aan naar een lange random string.
5. Bewerk de vragen gerust in de **Table Editor** (tabel `questions`) — dat is een spreadsheet-raster.

### 2. Config

Vul in `js/config.js`:

```js
export const SUPABASE_URL = "https://<project>.supabase.co";
export const SUPABASE_ANON_KEY = "<anon public key>";
```

(Te vinden onder Project Settings → API. De anon key is publiek; RLS beschermt de data.)

### 3. Hosten op GitHub Pages

1. Push de repo naar GitHub.
2. Settings → Pages → Source: `Deploy from a branch`, branch `main`, folder `/ (root)`.
3. De site staat op `https://<user>.github.io/<repo>/`.

De join-URL en QR gebruiken automatisch de juiste URL (incl. submap).

## Spelen

1. Open `host.html` op de laptop die op de projector hangt.
2. Voer eenmalig de **host-key** in (wordt lokaal onthouden).
3. Deel de QR / code met de zaal.
4. Start het spel: per vraag tonen → antwoorden → "Toon antwoord" → "Volgende vraag".
5. Op het einde krijgt elke speler een persoonlijke kaart om te delen.

## Beveiliging

- Spelers kunnen **niets** aan de score vervalsen: punten worden server-side berekend
  in de `submit_answer`-RPC op basis van de servertijd.
- De **vragen en juiste antwoorden** staan in Supabase, niet in de repo, en zijn niet
  leesbaar met de anon key. De host haalt ze op via `get_questions(host_key)`.
- Alleen `rooms`, `players` en `answers` zijn leesbaar voor anon; alle schrijfacties
  lopen via `security definer`-functies.
