import { sb, esc } from "./supabase-client.js";
import { loadBrand, config } from "./brand.js";
import { downloadAnswersPdf } from "./answers-pdf.js";

const $ = (id) => document.getElementById(id);
const LETTERS = "ABCD";
const OPTION_COUNT = 4;   // het spel gaat uit van 4 antwoordopties

let HOST_KEY = localStorage.getItem("host_key") || "";
let questions = [];
let statusTimer = null;
let cfg = { answer_seconds: 20, theme: "wannes", game_title: "" };
let parsedImport = null;

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  $(id).classList.remove("hidden");
}

function status(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  clearTimeout(statusTimer);
  if (msg && !isError) statusTimer = setTimeout(() => (el.textContent = ""), 3000);
}

/* ---------- Laden ---------- */

$("btn-load").onclick = () => load($("hostkey").value.trim() || HOST_KEY);

async function load(key) {
  $("setup-error").textContent = "";
  if (!key) { $("setup-error").textContent = "Vul de host-key in."; return; }
  const { data, error } = await sb.rpc("get_questions", { p_host_key: key });
  if (error) { $("setup-error").textContent = "Mislukt: " + error.message; return; }
  HOST_KEY = key;
  localStorage.setItem("host_key", key);
  questions = data || [];
  show("editor");
  render();
  await loadConfig();
}

async function reload() {
  const { data, error } = await sb.rpc("get_questions", { p_host_key: HOST_KEY });
  if (!error) {
    questions = data || [];
    render();
  }
}

/* ---------- Config ---------- */

async function loadConfig() {
  const { data } = await sb.from("game_config").select("*").eq("id", 1).maybeSingle();
  if (data) cfg = { ...cfg, ...data };
  $("cfg-seconds").value = cfg.answer_seconds ?? 20;
  $("cfg-title").value = cfg.game_title ?? "";
  setThemeButtons(cfg.theme || "wannes");
}

function setThemeButtons(theme) {
  document.querySelectorAll("#theme-switch button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.themeValue === theme));
  });
}

$("theme-switch").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-theme-value]");
  if (!b) return;
  cfg.theme = b.dataset.themeValue;
  setThemeButtons(cfg.theme);
  // meteen tonen in de admin zelf
  document.documentElement.dataset.theme = cfg.theme;
});

$("btn-save-config").onclick = async () => {
  const seconds = Number($("cfg-seconds").value) || 20;
  const theme = cfg.theme || "wannes";
  const title = $("cfg-title").value.trim();
  const { error } = await sb.rpc("host_set_config", {
    p_host_key: HOST_KEY,
    p_answer_seconds: seconds,
    p_theme: theme,
    p_game_title: title || null,
    p_accent: null,
  });
  if (error) { status("Fout: " + error.message, true); return; }
  status("Instellingen opgeslagen ✓");
  await loadConfig();
};

/* ---------- Importeren ---------- */

const dz = $("dropzone");
const fileInput = $("file");

dz.addEventListener("click", () => fileInput.click());
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("hover"); });
dz.addEventListener("dragleave", () => dz.classList.remove("hover"));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  dz.classList.remove("hover");
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

async function handleFile(file) {
  parsedImport = null;
  $("import-actions").classList.add("hidden");
  const name = file.name.toLowerCase();
  try {
    let parsed;
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      parsed = parseXlsx(await file.arrayBuffer());
    } else if (name.endsWith(".md") || name.endsWith(".markdown")) {
      parsed = parseMarkdown(await file.text());
    } else {
      parsed = parseCsv(await file.text());
    }
    renderPreview(parsed, file.name);
  } catch (e) {
    $("import-preview").innerHTML = `<p class="bad">Kon het bestand niet lezen: ${esc(e.message || e)}</p>`;
  }
}

function renderPreview(rows, filename) {
  if (!rows.length) {
    $("import-preview").innerHTML = `<p class="bad">Geen vragen gevonden in ${esc(filename)}. Controleer het formaat.</p>`;
    return;
  }
  const bad = rows.filter((r) => r._bad).length;
  const good = rows.length - bad;
  let html = `<p class="ok">${good} vraag/vragen gevonden${bad ? `, <span class="muted">${bad} zonder juist antwoord — die worden een peiling</span>` : ""}.</p><ol>`;
  rows.forEach((r) => {
    html += `<li>${esc(r.vraag)}<br><span class="muted">`;
    html += r.opties.map((o, i) => (i === r.juist ? `<strong>${LETTERS[i]}) ${esc(o)}</strong>` : `${LETTERS[i]}) ${esc(o)}`)).join(" &nbsp;·&nbsp; ");
    if (r.uitleg) html += `<br><em>${esc(r.uitleg)}</em>`;
    html += "</span></li>";
  });
  html += "</ol>";
  $("import-preview").innerHTML = html;
  parsedImport = rows;
  $("import-actions").classList.remove("hidden");
}

$("btn-import").onclick = async () => {
  if (!parsedImport || !parsedImport.length) return;
  const mode = document.querySelector('input[name="import-mode"]:checked')?.value || "append";
  const payload = parsedImport.map((r) => ({
    vraag: r.vraag,
    opties: r.opties,
    juist: r.juist,
    uitleg: r.uitleg || "",
  }));
  const { data, error } = await sb.rpc("host_import_questions", {
    p_host_key: HOST_KEY,
    p_questions: payload,
    p_replace: mode === "replace",
  });
  if (error) { status("Fout: " + error.message, true); return; }
  status(`${data} vraag/vragen geïmporteerd ✓`);
  parsedImport = null;
  $("import-preview").innerHTML = "";
  $("import-actions").classList.add("hidden");
  fileInput.value = "";
  await reload();
};

/* --- parsers --- */

function parseAnswer(v, n) {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return -1;
  if (/^[A-F]$/.test(s)) {
    const i = s.charCodeAt(0) - 65;
    return i < n ? i : -1;
  }
  const num = parseInt(s.replace(/[^0-9]/g, ""), 10);
  if (!isNaN(num)) {
    if (num >= 1 && num <= n) return num - 1;
    if (num === 0) return 0;
  }
  return -1;
}

function detectDelim(text) {
  const first = (text.split(/\r?\n/)[0] || "");
  const sc = (first.match(/;/g) || []).length;
  const cc = (first.match(/,/g) || []).length;
  return sc > cc ? ";" : ",";
}

function parseCsv(text) {
  const delim = detectDelim(text);
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delim) {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rowsToQuestions(rows.filter((r) => r.some((c) => String(c).trim() !== "")));
}

function parseXlsx(buf) {
  if (!window.XLSX) throw new Error("Excel-lezer niet geladen (geen internet?)");
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  return rowsToQuestions(rows.map((r) => r.map((c) => (c == null ? "" : c))));
}

function rowsToQuestions(rows) {
  if (!rows.length) return [];
  const first = rows[0].map((c) => String(c).trim().toLowerCase());
  const hasHeader = first.some((c) => /vraag|question/.test(c)) || first.includes("a");
  const header = hasHeader ? first : null;
  const data = hasHeader ? rows.slice(1) : rows;

  const findCol = (names) => (header ? header.findIndex((h) => names.some((n) => h === n || h.startsWith(n))) : -1);

  let vraagCol, juistCol, uitlegCol, optCols;
  if (header) {
    vraagCol = findCol(["vraag", "question"]);
    if (vraagCol < 0) vraagCol = 0;
    juistCol = findCol(["juist", "correct", "antwoord", "answer"]);
    uitlegCol = findCol(["uitleg", "toelichting", "duiding", "explanation"]);
    const letterCols = header.map((h, i) => ({ h, i })).filter(({ h }) => /^(optie\s*_?)?[a-f]$/.test(h));
    if (letterCols.length >= 2) {
      optCols = letterCols.map((x) => x.i);
    } else {
      const start = vraagCol + 1;
      const end = juistCol > start ? juistCol : Math.min(header.length, start + 4);
      optCols = [];
      for (let i = start; i < end; i++) optCols.push(i);
    }
  } else {
    vraagCol = 0; optCols = [1, 2, 3, 4]; juistCol = 5; uitlegCol = 6;
  }

  const out = [];
  for (const r of data) {
    const vraag = String(r[vraagCol] ?? "").trim();
    if (!vraag) continue;
    const opties = optCols.map((i) => String(r[i] ?? "").trim()).filter((o) => o !== "");
    if (opties.length < 2) continue;
    const juist = parseAnswer(r[juistCol], opties.length);
    const uitleg = uitlegCol >= 0 ? String(r[uitlegCol] ?? "").trim() : "";
    out.push({ vraag, opties, juist: juist < 0 ? null : juist, uitleg, _bad: juist < 0 });
  }
  return out;
}

function parseMarkdown(md) {
  const blocks = md.split(/\n(?=#{1,6}\s)/).map((b) => b.trim()).filter(Boolean);
  const out = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    let vraag = "", opties = [], juist = null, uitleg = "";
    for (const line of lines) {
      const h = line.match(/^#{1,6}\s*(.+)$/);
      if (h) { vraag = h[1].trim(); continue; }
      const bq = line.match(/^>\s*(.+)$/);
      if (bq) { uitleg = (uitleg ? uitleg + " " : "") + bq[1].trim(); continue; }
      const opt = line.match(/^[-*]\s+(.+)$/);
      if (opt) {
        let t = opt[1].trim();
        let correct = false;
        const cb = t.match(/^\[([xX ])\]\s*(.*)$/);
        if (cb) { correct = cb[1].toLowerCase() === "x"; t = cb[2].trim(); }
        else if (t.startsWith("*")) { correct = true; t = t.slice(1).trim(); }
        if (correct) juist = opties.length;
        opties.push(t);
        continue;
      }
      if (!opties.length) vraag = vraag ? vraag + " " + line : line;
    }
    if (vraag && opties.length >= 2) {
      out.push({ vraag, opties, juist, uitleg, _bad: false });
    }
  }
  return out;
}

/* ---------- Vragenlijst ---------- */

function render() {
  $("list").innerHTML = questions.length
    ? questions.map(cardHtml).join("")
    : `<p class="muted">Nog geen vragen. Voeg er een toe of importeer een bestand.</p>`;
}

function cardHtml(q) {
  const opts = (q.opties || []).slice(0, OPTION_COUNT);
  while (opts.length < OPTION_COUNT) opts.push("");
  const id = q.id ?? "";
  return `
  <div class="qcard" data-id="${id}" data-idx="${q.idx}">
    <div class="qcard-head">
      <span class="qcard-num">Vraag ${q.idx}</span>
      <div class="qcard-actions">
        <button class="btn small" data-act="up" title="Omhoog">↑</button>
        <button class="btn small" data-act="down" title="Omlaag">↓</button>
        <button class="btn small danger" data-act="del">Verwijderen</button>
      </div>
    </div>

    <label>Vraag</label>
    <input class="f-vraag" type="text" value="${esc(q.vraag || "")}" placeholder="Wat wil je vragen?">

    <label class="consent peiling-toggle">
      <input type="checkbox" class="f-peiling" ${q.juist == null ? "checked" : ""}>
      <span>Peiling — geen juist antwoord (geen punten, wel de verdeling om over te discussiëren)</span>
    </label>

    <label>Antwoorden — vink het juiste aan</label>
    <div class="opts">
      ${opts.map((o, i) => `
        <div class="optrow">
          <input type="radio" name="juist-${id || "new"}" value="${i}" ${i === (q.juist ?? 0) ? "checked" : ""} ${q.juist == null ? "disabled" : ""}>
          <b>${LETTERS[i]}</b>
          <input class="f-opt" type="text" value="${esc(o)}" placeholder="Antwoord ${LETTERS[i]}">
        </div>`).join("")}
    </div>

    <label>Duiding — extra tekst wanneer het juiste antwoord verschijnt (optioneel)</label>
    <input class="f-uitleg" type="text" value="${esc(q.uitleg || "")}" placeholder="Waarom is dit het juiste antwoord?">

    <button class="btn primary" data-act="save">Opslaan</button>
  </div>`;
}

$("list").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const card = btn.closest(".qcard");
  const id = card.dataset.id ? Number(card.dataset.id) : null;

  switch (btn.dataset.act) {
    case "save": await save(card, id); break;
    case "del":  await del(id); break;
    case "up":   await move(id, -1); break;
    case "down": await move(id, +1); break;
  }
});

$("list").addEventListener("change", (e) => {
  if (!e.target.classList.contains("f-peiling")) return;
  const card = e.target.closest(".qcard");
  card.querySelectorAll('input[type="radio"]').forEach((r) => { r.disabled = e.target.checked; });
});

async function save(card, id) {
  const vraag = card.querySelector(".f-vraag").value.trim();
  const opties = [...card.querySelectorAll(".f-opt")].map((i) => i.value.trim());
  const peiling = card.querySelector(".f-peiling")?.checked;
  const checked = card.querySelector('input[type="radio"]:checked');
  const juist = peiling ? null : checked ? Number(checked.value) : 0;
  const uitleg = card.querySelector(".f-uitleg").value.trim();

  if (!vraag) { status("Vul eerst de vraag in.", true); return; }
  if (opties.some((o) => !o)) { status("Vul alle antwoorden in.", true); return; }

  const { error } = await sb.rpc("host_save_question", {
    p_host_key: HOST_KEY,
    p_id: id,
    p_idx: null,
    p_vraag: vraag,
    p_opties: opties,
    p_juist: juist,
    p_uitleg: uitleg || null,
  });
  if (error) { status("Fout: " + error.message, true); return; }
  status(id ? "Opgeslagen ✓" : "Vraag toegevoegd ✓");
  await reload();
}

async function del(id) {
  if (id === null) { await reload(); return; }
  if (!confirm("Deze vraag verwijderen?")) return;
  const { error } = await sb.rpc("host_delete_question", { p_host_key: HOST_KEY, p_id: id });
  if (error) { status("Fout: " + error.message, true); return; }
  status("Verwijderd ✓");
  await reload();
}

async function move(id, dir) {
  if (id === null) return;
  const { error } = await sb.rpc("host_move_question", { p_host_key: HOST_KEY, p_id: id, p_dir: dir });
  if (error) { status("Fout: " + error.message, true); return; }
  await reload();
}

$("btn-add").onclick = () => {
  const maxIdx = questions.reduce((m, q) => Math.max(m, q.idx), 0);
  questions.push({ id: null, idx: maxIdx + 1, vraag: "", opties: ["", "", "", ""], juist: 0, uitleg: "" });
  render();
  const last = $("list").lastElementChild;
  last.scrollIntoView({ behavior: "smooth", block: "center" });
  last.querySelector(".f-vraag").focus();
};

/* ---------- E-mailadressen ---------- */

let leads = [];

$("btn-leads").onclick = loadLeads;

async function loadLeads() {
  const { data, error } = await sb.rpc("host_leads", { p_host_key: HOST_KEY });
  if (error) { status("Fout: " + error.message, true); return; }
  leads = data || [];
  $("leads-count").textContent = leads.length
    ? `${leads.length} adres(sen) — laatste: ${new Date(leads[0].created_at).toLocaleString("nl-BE")}`
    : "Nog geen adressen.";
  if (leads.length) status(`${leads.length} adres(sen) geladen ✓`);
}

$("btn-leads-csv").onclick = async () => {
  if (!leads.length) await loadLeads();
  if (!leads.length) { status("Nog geen adressen om te downloaden.", true); return; }

  const header = ["datum", "naam", "email", "score", "room"];
  const rows = leads.map((l) => [
    new Date(l.created_at).toISOString().slice(0, 10),
    l.name || "",
    l.email,
    l.score ?? "",
    l.room_id || "",
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

/* ---------- Antwoorden als PDF (neutrale versie, om zelf door te sturen) ---------- */

$("btn-answers-pdf").onclick = () => {
  const cfg = config();
  const ok = downloadAnswersPdf({
    title: cfg.game_title,
    url: "play.wann.es",
    accentHex: cfg.accent || "#FAC213",
    answers: questions.map((q) => ({
      vraag: q.vraag,
      opties: q.opties,
      juist: q.juist,
      uitleg: q.uitleg,
    })),
  });
  if (!ok) status("Geen vragen geladen om een PDF van te maken.", true);
};

/* ---------- Start ---------- */

loadBrand();
if (HOST_KEY) {
  $("hostkey").value = HOST_KEY;
  load(HOST_KEY);
}
