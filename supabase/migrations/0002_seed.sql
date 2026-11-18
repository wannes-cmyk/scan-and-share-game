-- Seed: host-key + 5 vragen. Pas aan naar wens.
-- De host-key is het geheime wachtwoord dat de host eenmalig intypt.
-- Herinnering: een apostrof in SQL-tekst schrijf je als twee apostroffen ('').

insert into settings (key, value)
values ('host_key', 'KIES-EEN-LANGE-RANDOM-STRING-hier')
on conflict (key) do nothing;   -- laat een bestaande (echte) host-key met rust

insert into questions (idx, vraag, opties, juist, uitleg) values
  (1, 'Hoeveel procent van je werk denk je dat AI binnen 2 jaar overneemt?',
      '["Minder dan 10%", "10 tot 30%", "30 tot 60%", "Meer dan 60%"]'::jsonb, 2,
      'De meningen lopen sterk uiteen - daarom is dit een goede discussiestarter.'),
  (2, 'Wat kan een taalmodel vandaag het BEST?',
      '["Feilloos rekenen", "Tekst samenvatten en herschrijven", "De toekomst voorspellen", "Zelfstandig beslissingen nemen"]'::jsonb, 1,
      'Samenvatten en herschrijven is waar het uitblinkt; rekenen en voorspellen blijven zwak.'),
  (3, 'Wie is het snelst met een complexe spreadsheet-formule?',
      '["De expert", "De stagiair", "AI", "Maakt niet uit"]'::jsonb, 2,
      'Dit is de kern: AI verslaat de expert op snelheid, niet altijd op oordeel.'),
  (4, 'Wat is het grootste risico van AI-output zonder controle?',
      '["Het is te duur", "Het klinkt overtuigend maar kan fout zijn", "Het is te traag", "Het kan niet in het Nederlands"]'::jsonb, 1,
      'Hallucinaties zijn gevaarlijk omdat ze zelfverzekerd klinken.'),
  (5, 'Wat blijft het meest waardevol in een AI-tijdperk?',
      '["Snel typen", "Kennis uit het hoofd", "Beslissen wat juist is", "Excel kunnen"]'::jsonb, 2,
      'Het oordeel - weten wat je moet vertrouwen - wordt schaarser en dus waardevoller.')
on conflict (idx) do nothing;
