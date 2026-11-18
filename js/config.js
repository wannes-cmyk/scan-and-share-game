// Vul dit in na het aanmaken van je Supabase-project.
// Project Settings -> API -> Project URL / anon public key.
export const SUPABASE_URL = "https://xfkawmxopgcfypxhjkdx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhma2F3bXhvcGdjZnlweGhqa2R4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5NDYzNDUsImV4cCI6MjExMDUyMjM0NX0.fxfdfG_kb0xuSIZf--TpVp4QNGdPUpTLhKVu7KbdQSE";

// Branding / standaardwaarden. De echte waarden komen uit Supabase (tabel game_config)
// en zijn aanpasbaar in admin.html. Dit is enkel de terugval als Supabase onbereikbaar is.
export const FALLBACK = {
  theme: "wannes",              // "wannes" (AI wann.es) | "punk"
  accent: "#FAC213",            // accentkleur van ai.wann.es
  game_title: "AI kills the expert — live quiz",
  answer_seconds: 20,
};

// Vaste merkwaarden (niet aanpasbaar via de admin)
export const BRAND = {
  name: "AI wann.es",
  url: "https://ai.wann.es",
  logo: "assets/logo.webp",
  accent2: "#EA5758",
};
