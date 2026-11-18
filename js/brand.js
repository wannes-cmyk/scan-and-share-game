import { sb } from "./supabase-client.js";
import { FALLBACK, BRAND } from "./config.js";

// Centrale merk-/spelconfiguratie. Wordt geladen uit Supabase (game_config)
// en live bijgewerkt als de admin iets wijzigt.

let cfg = { ...FALLBACK };
let channel = null;

export function config() {
  return cfg;
}

export function brand() {
  return BRAND;
}

/**
 * Laadt game_config en past de branding toe op de pagina.
 * @param {{subscribe?: boolean}} opts  subscribe = live meevolgen (host/play)
 */
export async function loadBrand(opts = {}) {
  try {
    const { data } = await sb.from("game_config").select("*").eq("id", 1).maybeSingle();
    if (data) cfg = { ...cfg, ...data };
  } catch (e) {
    /* Supabase onbereikbaar? gebruik de terugval */
  }
  apply();
  if (opts.subscribe) watch();
  return cfg;
}

function watch() {
  if (channel) return;
  channel = sb
    .channel("brand-config")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "game_config" },
      (p) => {
        cfg = { ...cfg, ...p.new };
        apply();
      }
    )
    .subscribe();
}

const PUNK_ACCENT = "#EA5758";

/** De accentkleur die nu geldt (thema-afhankelijk). */
export function effectiveAccent() {
  return cfg.theme === "punk" ? PUNK_ACCENT : (cfg.accent || FALLBACK.accent);
}

/** Zet thema, accentkleur, titel en logo op de pagina. */
export function apply() {
  const root = document.documentElement;
  const theme = cfg.theme || "wannes";
  root.dataset.theme = theme;
  // Het punk-thema heeft zijn eigen accentkleur; de instelbare accentkleur geldt voor AI wann.es.
  if (theme === "wannes") {
    root.style.setProperty("--accent", cfg.accent || FALLBACK.accent);
  } else {
    root.style.removeProperty("--accent");
  }

  document.querySelectorAll("[data-brand-title]").forEach((el) => {
    el.textContent = cfg.game_title || FALLBACK.game_title;
  });
  document.querySelectorAll("[data-brand-name]").forEach((el) => {
    el.textContent = BRAND.name;
  });
  document.querySelectorAll("[data-brand-logo]").forEach((el) => {
    if (el.tagName === "IMG" && !el.getAttribute("src")) el.src = BRAND.logo;
  });
}
