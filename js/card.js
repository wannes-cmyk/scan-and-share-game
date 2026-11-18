import { BRAND } from "./config.js";

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Tekent de persoonlijke eindkaart (1080x1920, Story-formaat).
 */
export async function drawCard(canvas, opts = {}) {
  const {
    name = "Speler",
    score = 0,
    rank = 1,
    total = 1,
    title = "",
    url = "",
    accent = "#FAC213",
    logoUrl = BRAND.logo,
  } = opts;

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
  c.fillStyle = accent;
  c.fillRect(0, 0, W, 18);

  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) { /* ignore */ }
  }

  const fmt = (n) => new Intl.NumberFormat("nl-BE").format(n);
  const ordinal = (n) => `${n}e`;
  const logo = await loadImage(logoUrl);

  c.textAlign = "left";
  c.textBaseline = "alphabetic";

  // Merkteken + merknaam
  let textX = 80;
  if (logo) {
    const cx = 80 + 62, cy = 210, r = 62;
    c.fillStyle = accent;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    const s = r * 1.5;
    c.drawImage(logo, cx - s / 2, cy - s / 2, s, s);
    textX = 80 + 150;
  }

  c.fillStyle = "#ffffff";
  c.font = "800 46px Montserrat, system-ui, sans-serif";
  c.fillText(BRAND.name, textX, 200);

  c.fillStyle = "rgba(255,255,255,0.6)";
  c.font = "600 32px Montserrat, system-ui, sans-serif";
  let t = String(title || "");
  while (c.measureText(t).width > W - textX - 80 && t.length > 4) t = t.slice(0, -1);
  c.fillText(t, textX, 248);

  // Kop
  c.fillStyle = accent;
  c.font = "800 40px Montserrat, system-ui, sans-serif";
  c.fillText("IK SPEELDE MEE", 80, 430);

  // Naam
  c.fillStyle = "#ffffff";
  c.font = "800 104px Montserrat, system-ui, sans-serif";
  let nameText = String(name || "Speler").slice(0, 18);
  while (c.measureText(nameText).width > W - 160 && nameText.length > 3) {
    nameText = nameText.slice(0, -1);
  }
  c.fillText(nameText, 80, 570);

  // Score
  c.fillStyle = accent;
  c.font = "800 210px Montserrat, system-ui, sans-serif";
  const scoreText = fmt(score);
  c.fillText(scoreText, 80, 860);
  const scoreWidth = c.measureText(scoreText).width;
  c.fillStyle = "rgba(255,255,255,0.75)";
  c.font = "600 54px Montserrat, system-ui, sans-serif";
  c.fillText("punten", 80 + scoreWidth + 28, 860);

  // Positie
  c.fillStyle = "#ffffff";
  c.font = "700 62px Montserrat, system-ui, sans-serif";
  c.fillText(`${ordinal(rank)} van ${total}`, 80, 990);

  // Lijn
  c.strokeStyle = "rgba(255,255,255,0.15)";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(80, 1110);
  c.lineTo(W - 80, 1110);
  c.stroke();

  // Voettekst
  c.fillStyle = "rgba(255,255,255,0.6)";
  c.font = "600 38px Montserrat, system-ui, sans-serif";
  c.fillText("Speel mee op", 80, H - 150);
  c.fillStyle = accent;
  c.font = "800 50px Montserrat, system-ui, sans-serif";
  c.fillText(String(url || "").replace(/^https?:\/\//, "").slice(0, 40), 80, H - 88);
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
    } catch (e) { /* geannuleerd of niet ondersteund -> download */ }
  }
  await downloadCard(canvas);
}
