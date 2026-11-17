import { ACCENT } from "./config.js";

/**
 * Tekent de persoonlijke eindkaart op een canvas (1080x1920, Story-formaat).
 */
export async function drawCard(canvas, { name, score, rank, total, title, url }) {
  const W = 1080, H = 1920;
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d");

  // Achtergrond
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#191922");
  g.addColorStop(1, "#0b0b0f");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  // Accentbalk bovenaan
  c.fillStyle = ACCENT;
  c.fillRect(0, 0, W, 18);

  // Wacht op webfonts voor we tekst tekenen
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) { /* ignore */ }
  }

  const fmt = (n) => new Intl.NumberFormat("nl-BE").format(n);
  const ordinal = (n) => `${n}e`;

  c.textAlign = "left";
  c.textBaseline = "alphabetic";

  // Titel
  c.fillStyle = "rgba(255,255,255,0.65)";
  c.font = "600 44px system-ui, -apple-system, sans-serif";
  c.fillText(String(title).slice(0, 46), 80, 240);

  // "Ik speelde mee"
  c.fillStyle = ACCENT;
  c.font = "800 40px system-ui, -apple-system, sans-serif";
  c.fillText("IK SPEELDE MEE", 80, 360);

  // Naam
  c.fillStyle = "#ffffff";
  c.font = "800 108px system-ui, -apple-system, sans-serif";
  let nameText = String(name || "Speler").slice(0, 18);
  while (c.measureText(nameText).width > W - 160 && nameText.length > 3) {
    nameText = nameText.slice(0, -1);
  }
  c.fillText(nameText, 80, 520);

  // Score (groot, accent)
  c.fillStyle = ACCENT;
  c.font = "800 220px system-ui, -apple-system, sans-serif";
  c.fillText(fmt(score), 80, 820);
  const scoreWidth = c.measureText(fmt(score)).width;
  c.fillStyle = "rgba(255,255,255,0.75)";
  c.font = "600 56px system-ui, -apple-system, sans-serif";
  c.fillText("punten", 80 + scoreWidth + 30, 820);

  // Positie
  c.fillStyle = "#ffffff";
  c.font = "700 64px system-ui, -apple-system, sans-serif";
  c.fillText(`${ordinal(rank)} van ${total}`, 80, 950);

  // Divider
  c.strokeStyle = "rgba(255,255,255,0.15)";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(80, 1060);
  c.lineTo(W - 80, 1060);
  c.stroke();

  // Voettekst
  c.fillStyle = "rgba(255,255,255,0.6)";
  c.font = "600 40px system-ui, -apple-system, sans-serif";
  c.fillText("Speel mee op", 80, H - 140);
  c.fillStyle = ACCENT;
  c.font = "800 52px system-ui, -apple-system, sans-serif";
  c.fillText(String(url || "").replace(/^https?:\/\//, "").slice(0, 40), 80, H - 80);
}

export function cardToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

export async function downloadCard(canvas, filename = "live-quiz-kaart.png") {
  const blob = await cardToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function shareCard(canvas, text = "Ik speelde mee!") {
  const blob = await cardToBlob(canvas);
  const file = new File([blob], "live-quiz-kaart.png", { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return;
    } catch (e) { /* gebruiker annuleerde of faalde -> download */ }
  }
  await downloadCard(canvas);
}
