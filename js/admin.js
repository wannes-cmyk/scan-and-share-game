import { sb, esc } from "./supabase-client.js";

const $ = (id) => document.getElementById(id);
const LETTERS = "ABCD";
const OPTION_COUNT = 4;   // het spel gaat uit van 4 antwoordopties

let HOST_KEY = localStorage.getItem("host_key") || "";
let questions = [];
let statusTimer = null;

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  $(id).classList.remove("hidden");
}

function status(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  clearTimeout(statusTimer);
  if (msg && !isError) statusTimer = setTimeout(() => (el.textContent = ""), 2500);
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
}

async function reload() {
  const { data, error } = await sb.rpc("get_questions", { p_host_key: HOST_KEY });
  if (!error) {
    questions = data || [];
    render();
  }
}

/* ---------- Weergeven ---------- */

function render() {
  $("list").innerHTML = questions.length
    ? questions.map(cardHtml).join("")
    : `<p class="muted">Nog geen vragen. Voeg er een toe.</p>`;
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

    <label>Antwoorden — vink het juiste aan</label>
    <div class="opts">
      ${opts.map((o, i) => `
        <div class="optrow">
          <input type="radio" name="juist-${id || "new"}" value="${i}" ${i === (q.juist ?? 0) ? "checked" : ""}>
          <b>${LETTERS[i]}</b>
          <input class="f-opt" type="text" value="${esc(o)}" placeholder="Antwoord ${LETTERS[i]}">
        </div>`).join("")}
    </div>

    <label>Uitleg na het antwoord (optioneel)</label>
    <input class="f-uitleg" type="text" value="${esc(q.uitleg || "")}" placeholder="Eén zin uitleg">

    <button class="btn primary" data-act="save">Opslaan</button>
  </div>`;
}

/* ---------- Acties ---------- */

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

async function save(card, id) {
  const vraag = card.querySelector(".f-vraag").value.trim();
  const opties = [...card.querySelectorAll(".f-opt")].map((i) => i.value.trim());
  const checked = card.querySelector('input[type="radio"]:checked');
  const juist = checked ? Number(checked.value) : 0;
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
  if (id === null) {  // nog niet opgeslagen kaart
    await reload();
    return;
  }
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
  $("list").lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
  $("list").lastElementChild.querySelector(".f-vraag").focus();
};

/* ---------- Auto-load als de key al bekend is ---------- */

if (HOST_KEY) {
  $("hostkey").value = HOST_KEY;
  load(HOST_KEY);
}
