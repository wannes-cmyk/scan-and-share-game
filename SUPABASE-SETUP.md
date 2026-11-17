# Supabase opzetten — wat er moet gebeuren

Dit project (`scan-and-share-game`) is een **statische live-quiz**: één groot scherm (host)
toont een QR, deelnemers spelen mee op hun gsm, backend op Supabase, gehost op GitHub Pages.
De frontend is af. **De Supabase-backend moet nog opgezet worden.** Hieronder de exacte stappen.

## Wat je nodig hebt

- Een Supabase-account en een (nieuw) project. De gratis tier volstaat ruim.

## Stappen

1. **Maak een Supabase-project** aan. Noteer de **Project URL** en de **anon public key**
   (Project Settings → API).
2. Open de **SQL Editor** en voer `supabase/migrations/0001_init.sql` volledig uit.
   Dit maakt de tabellen, RLS, de RPC's en zet Realtime aan. Het script is idempotent
   (je mag het opnieuw draaien).
3. Bewerk `supabase/migrations/0002_seed.sql`: vervang `KIES-EEN-LANGE-RANDOM-STRING-hier`
   door een **sterke random host-key** (32+ tekens). Voer het dan uit.
   Die host-key is het "wachtwoord" van de quizmaster — de host typt hem eenmalig in op
   `host.html`. Bewaar hem goed.
4. Controleer de vragen in **Table Editor → `questions`** (5 rijen). Pas de inhoud gerust aan
   naar het echte thema; het zijn nu voorbeeldvragen.
5. Vul `js/config.js` in:
   ```js
   export const SUPABASE_URL = "https://<project>.supabase.co";
   export const SUPABASE_ANON_KEY = "<anon public key>";
   ```
6. Controleer Realtime: **Database → Replication** — de tabellen `rooms`, `players` en
   `answers` moeten in de publicatie `supabase_realtime` staan. (Stap 2 doet dit al.)
7. Meld terug: project-URL ingevuld? host-key gezet? vragen klaar? anon key in `config.js`?

## Verificatie — doe dit écht

In de SQL Editor:

- `select host_create_room('<host-key>');` → geeft een 4-cijferige code.
- `select * from get_questions('<host-key>');` → 5 vragen.
- `select host_create_room('fout');` → moet **falen** met "ongeldige host key".

Met de **anon key** (via de REST API of de app):

- `select` op `questions` en `settings` → moet **geweigerd** worden.
- `select` op `rooms`, `players`, `answers` → moet lukken.

End-to-end:

- Start de site lokaal (`python3 -m http.server 8000` in de projectmap).
- Open `host.html`, voer de host-key in, deel de QR.
- Speel met 2 gsm's/browsers een volledig spel: lobby → 5 vragen → eindstand.
- Controleer dat de score klopt (juist = 1000 + snelheidsbonus, fout = 0) en dat elke
  speler op het einde een PNG-kaart kan downloaden.

## Ontwerpregels — niet "verbeteren"

- **Vragen en juiste antwoorden horen NIET in de client of in de repo.** Ze staan in de
  tabel `questions` (RLS aan, géén anon-policy); de host leest ze via `get_questions(host_key)`.
- **Scores worden server-side berekend** in `submit_answer`, op basis van de servertijd.
  Verplaats dat niet naar JavaScript.
- **Host-acties lopen via `host_*`-RPC's** die de host-key checken. Voeg géén
  anon-schrijfrechten toe op `rooms`.
- De **anon key is publiek** — dat is de bedoeling. De veiligheid zit in RLS +
  `security definer`, niet in het geheimhouden van de anon key.
- Alle `security definer`-functies hebben `set search_path = public`. Laat dat staan.

## Als er iets faalt

- **"permission denied for table X"** bij anon → de `grant select` ontbreekt. Die staat in
  `0001_init.sql`; controleer of die regel mee uitgevoerd is.
- **Geen live updates** → de tabel staat niet in de `supabase_realtime`-publicatie, óf anon
  heeft geen SELECT-policy op die tabel (Realtime respecteert RLS).
- **"ongeldige host key"** terwijl je de juiste typt → `settings.host_key` wijkt af; check
  de Table Editor en werk de rij bij.
