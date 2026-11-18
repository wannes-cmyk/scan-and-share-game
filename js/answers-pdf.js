import { BRAND } from "./config.js";

const LETTERS = "ABCD";

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return [250, 194, 19];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Maakt een PDF met alle vragen, het juiste antwoord en de duiding.
 *
 * @param {object} opts
 * @param {string} [opts.title]      speltitel
 * @param {string} [opts.url]        website onderaan
 * @param {string} [opts.accentHex]  accentkleur
 * @param {Array}  opts.answers      [{ vraag, opties, juist, uitleg }]
 * @param {object} [opts.player]     optioneel { name, score, rank, total } — weglaten
 *                                   voor een neutrale versie (bv. vanuit het beheer)
 * @returns {boolean} true als er een PDF gemaakt is
 */
export function downloadAnswersPdf(opts = {}) {
  const {
    title = "Live quiz",
    url = "play.wann.es",
    accentHex = "#FAC213",
    answers = [],
    player = null,
  } = opts;

  if (!window.jspdf || !answers.length) return false;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;

  // accentbalk
  doc.setFillColor(...hexToRgb(accentHex));
  doc.rect(0, 0, W, 10, "F");

  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(String(title), M, 70);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(120);
  if (player) {
    doc.text(`${player.name} — ${player.score} punten — ${player.rank}e van ${player.total}`, M, 92);
    doc.text(`${BRAND.name} · ${url}`, M, 108);
  } else {
    doc.text(`${BRAND.name} · ${url}`, M, 92);
  }

  let y = player ? 150 : 134;

  answers.forEach((q, i) => {
    doc.setTextColor(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    const qLines = doc.splitTextToSize(`${i + 1}. ${q.vraag}${q.juist == null ? "   (peiling)" : ""}`, W - 2 * M);
    doc.text(qLines, M, y);
    y += qLines.length * 17 + 6;

    doc.setFontSize(11);
    (q.opties || []).forEach((o, j) => {
      const correct = j === q.juist;
      doc.setFont("helvetica", correct ? "bold" : "normal");
      doc.setTextColor(correct ? 20 : 130);
      const lines = doc.splitTextToSize(`${LETTERS[j]}) ${o}${correct ? "   ✓" : ""}`, W - 2 * M - 18);
      doc.text(lines, M + 18, y);
      y += lines.length * 15;
    });

    if (q.uitleg) {
      doc.setFont("helvetica", "italic");
      doc.setTextColor(90);
      const uLines = doc.splitTextToSize(q.uitleg, W - 2 * M - 18);
      y += 4;
      doc.text(uLines, M + 18, y);
      y += uLines.length * 15;
    }

    y += 22;
    if (y > H - 90) {
      doc.addPage();
      y = 70;
    }
  });

  const safe = String(title).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  doc.save(`antwoorden-${safe || "quiz"}.pdf`);
  return true;
}
