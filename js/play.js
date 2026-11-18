import { sb, esc } from "./supabase-client.js";
import { loadBrand, config, effectiveAccent } from "./brand.js";
import { drawCard, downloadCard, shareCard } from "./card.js";
import { downloadAnswersPdf } from "./answers-pdf.js";

const $ = (id) => document.getElementById(id);
const LETTERS = "ABCD";

const params = new URLSearchParams(location.search);
let roomId = params.get("room") || "";
let playerId = localStorage.getItem("player_" + roomId) || null;
let playerName = localStorage.getItem("name_" + roomId) || "";
let channel = null;
let timerHandle = null;

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  $(id).classList.remove("hidden");
}

/* ---------- Joinen ---------- */

$("roomlabel").textContent = roomId ? `Room ${roomId}` : "";

if (!roomId) {
  $("roomlabel").textContent = "Geen roomcode in de link. Scan opnieuw de QR-code.";
  $("btn-join").disabled = true;
}

if (playerId) {
  enterGame();
}

$("btn-join").onclick = async () => {
  const name = $("name").value.trim();
  $("joinerror").textContent = "";
  if (!name) { $("joinerror").textContent = "Vul je naam in."; return; }
  const { data, error } = await sb.rpc("join_room", { p_room_id: roomId, p_name: name });
  if (error) { $("joinerror").textContent = "Kon niet joinen: " + error.message; return; }
  playerId = data;
  playerName = name;
  localStorage.setItem("player_" + roomId, playerId);
  localStorage.setItem("name_" + roomId, name);
  enterGame();
};

/* ---------- Spel ---------- */

async function enterGame() {
  show("wait");
  $("waittitle").textContent = "Welkom, " + playerName;
  const room = await getRoom();
  if (room) applyRoom(room);
  subscribe();
}

async function getRoom() {
  const { data } = await sb
    .from("rooms")
    .select("state,question,question_index,deadline,correct_index")
    .eq("id", roomId)
    .maybeSingle();
  return data;
}

function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb
    .channel("play-" + roomId)
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
      (p) => applyRoom(p.new))
    .subscribe();
}

function applyRoom(room) {
  if (!room) return;
  switch (room.state) {
    case "question": showQuestion(room); break;
    case "reveal": showReveal(room); break;
    case "end": showEnd(); break;
    default: show("wait"); break;
  }
}

function startTimer(deadline) {
  clearInterval(timerHandle);
  const end = deadline ? new Date(deadline).getTime() : Date.now();
  const tick = () => {
    const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    $("ptimer").textContent = left + "s";
    if (left <= 0) clearInterval(timerHandle);
  };
  tick();
  timerHandle = setInterval(tick, 250);
}

function showQuestion(room) {
  show("question");
  $("pqvraag").textContent = room.question?.vraag || "";
  const answered = localStorage.getItem("ans_" + roomId + "_" + room.question_index);
  $("popties").innerHTML = (room.question?.opties || [])
    .map((o, i) => `<button class="optie-btn" data-i="${i}" ${answered !== null ? "disabled" : ""}><b>${LETTERS[i]}</b><span>${esc(o)}</span></button>`)
    .join("");
  $("popties").querySelectorAll("button").forEach((b) => {
    b.onclick = () => answer(room, Number(b.dataset.i));
  });
  $("panswered").textContent = answered !== null ? "Antwoord ontvangen ✓" : "";
  $("puitleg").classList.add("hidden");
  $("puitleg").innerHTML = "";
  startTimer(room.deadline);
}

async function answer(room, choice) {
  $("popties").querySelectorAll("button").forEach((b) => (b.disabled = true));
  const { error } = await sb.rpc("submit_answer", {
    p_room_id: roomId,
    p_player_id: playerId,
    p_question_index: room.question_index,
    p_choice: choice,
  });
  if (error) {
    $("panswered").textContent = error.message;
    $("popties").querySelectorAll("button").forEach((b) => (b.disabled = false));
    return;
  }
  localStorage.setItem("ans_" + roomId + "_" + room.question_index, String(choice));
  $("panswered").textContent = "Antwoord ontvangen ✓";
}

async function showReveal(room) {
  const mine = localStorage.getItem("ans_" + roomId + "_" + room.question_index);
  const heeftJuist = room.correct_index !== null && room.correct_index !== undefined;

  [...$("popties").children].forEach((el, i) => {
    el.disabled = true;
    const isMine = mine !== null && Number(mine) === i;
    if (heeftJuist) {
      if (i === room.correct_index) el.classList.add("juist");
      else if (isMine) el.classList.add("fout");
    } else if (isMine) {
      el.classList.add("mijn");  // peiling: jouw keuze, zonder goed of fout
    }
  });

  clearInterval(timerHandle);
  $("ptimer").textContent = "";
  $("panswered").textContent = !heeftJuist
    ? mine !== null
      ? "Bedankt voor je antwoord."
      : "Geen antwoord."
    : mine !== null && Number(mine) === room.correct_index
      ? "Juist! 🎉"
      : mine !== null
        ? "Helaas."
        : "Geen antwoord.";

  // Duiding van de host
  const uitleg = (room.question?.uitleg || "").trim();
  const el = $("puitleg");
  if (uitleg) {
    el.innerHTML = `<strong>${esc(uitleg)}</strong>`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }

  await renderPlayerDist(room);
}

/** De verdeling van de antwoorden, ook op de gsm van de speler. */
async function renderPlayerDist(room) {
  const el = $("pdist");
  if (!el) return;
  const n = (room.question?.opties || []).length;
  if (!n) { el.classList.add("hidden"); return; }

  const { data } = await sb
    .from("answers")
    .select("choice")
    .eq("room_id", roomId)
    .eq("question_index", room.question_index);

  const counts = new Array(n).fill(0);
  (data || []).forEach((a) => { if (a.choice >= 0 && a.choice < n) counts[a.choice]++; });
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) { el.classList.add("hidden"); return; }

  const heeftJuist = room.correct_index !== null && room.correct_index !== undefined;
  el.innerHTML =
    `<p class="muted small">${total} antwoord${total === 1 ? "" : "en"}</p>` +
    counts
      .map((c, i) => {
        const pct = Math.round((c / total) * 100);
        const juist = heeftJuist && i === room.correct_index;
        return `<div class="bar${juist ? " correct" : ""}">
          <div class="fill" style="width:${pct}%"></div>
          <span>${LETTERS[i]}${juist ? " ✓" : ""} — ${c} (${pct}%)</span>
        </div>`;
      })
      .join("");
  el.classList.remove("hidden");
}

/* ---------- Einde ---------- */

let answers = [];
let myScore = 0;
let myRank = 1;
let myTotal = 1;

async function showEnd() {
  show("end");
  const { data } = await sb
    .from("players")
    .select("id,name,score")
    .eq("room_id", roomId)
    .order("score", { ascending: false });
  const list = data || [];
  const rank = list.findIndex((p) => p.id === playerId) + 1;
  const me = list.find((p) => p.id === playerId) || { score: 0 };
  const base = location.origin + location.pathname.replace(/play\.html$/, "");
  const cfg = config();

  myScore = me.score;
  myRank = rank || list.length || 1;
  myTotal = list.length;

  await drawCard($("card"), {
    name: playerName,
    score: myScore,
    rank: myRank,
    total: myTotal,
    title: cfg.game_title,
    url: base,
    accent: effectiveAccent(),
  });

  $("btn-download").onclick = () => downloadCard($("card"));
  $("btn-share").onclick = () => shareCard($("card"), `${playerName} — ${myScore} punten in ${cfg.game_title}`);

  await loadAnswers();
}

/* ---------- De juiste antwoorden ---------- */

async function loadAnswers() {
  const { data, error } = await sb.rpc("get_answers", { p_room_id: roomId });
  if (error) {
    $("answers").innerHTML = `<p class="muted">De antwoorden zijn nog niet beschikbaar.</p>`;
    $("btn-pdf").disabled = true;
    return;
  }
  answers = Array.isArray(data) ? data : [];
  if (!answers.length) {
    $("answers").innerHTML = `<p class="muted">Geen antwoorden gevonden.</p>`;
    $("btn-pdf").disabled = true;
    return;
  }
  $("answers").innerHTML = answers
    .map((q, i) => `
      <div class="ans">
        <p class="ans-q">${i + 1}. ${esc(q.vraag)}${q.juist == null ? ' <span class="peiling-tag">peiling</span>' : ""}</p>
        <ul class="ans-opts">
          ${q.opties
            .map((o, j) => `<li class="${j === q.juist ? "juist" : ""}"><b>${LETTERS[j]}</b> ${esc(o)}${j === q.juist ? " ✓" : ""}</li>`)
            .join("")}
        </ul>
        ${q.uitleg ? `<p class="ans-uitleg">${esc(q.uitleg)}</p>` : ""}
      </div>`)
    .join("");
  $("btn-pdf").onclick = downloadMyAnswersPdf;
}

function downloadMyAnswersPdf() {
  downloadAnswersPdf({
    title: config().game_title,
    url: location.origin + location.pathname.replace(/play\.html$/, ""),
    accentHex: effectiveAccent(),
    answers,
    player: { name: playerName, score: myScore, rank: myRank, total: myTotal },
  });
}

/* ---------- E-mailadres ---------- */

function leadMsg(msg, isError = false) {
  const el = $("lead-msg");
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

$("btn-lead").onclick = async () => {
  const email = $("lead-email").value.trim();
  const consent = $("lead-consent").checked;
  leadMsg("");
  if (!email) { leadMsg("Vul je e-mailadres in.", true); return; }
  if (!consent) { leadMsg("Vink eerst het vakje aan.", true); return; }

  $("btn-lead").disabled = true;
  const { error } = await sb.rpc("register_lead", {
    p_room_id: roomId,
    p_player_id: playerId,
    p_email: email,
    p_consent: consent,
  });
  if (error) {
    leadMsg("Fout: " + error.message, true);
    $("btn-lead").disabled = false;
    return;
  }
  leadMsg("Top, je hoort van ons! ✓");
  $("lead-email").disabled = true;
  $("lead-consent").disabled = true;
};

/* ---------- Start ---------- */

loadBrand({ subscribe: true });
