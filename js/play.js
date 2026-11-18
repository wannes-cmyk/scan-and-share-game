import { sb, esc } from "./supabase-client.js";
import { loadBrand, config } from "./brand.js";
import { drawCard, downloadCard, shareCard } from "./card.js";

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

function showReveal(room) {
  const mine = localStorage.getItem("ans_" + roomId + "_" + room.question_index);
  [...$("popties").children].forEach((el, i) => {
    el.disabled = true;
    if (i === room.correct_index) el.classList.add("juist");
    else if (mine !== null && Number(mine) === i) el.classList.add("fout");
  });
  clearInterval(timerHandle);
  $("ptimer").textContent = "";
  $("panswered").textContent =
    mine !== null && Number(mine) === room.correct_index ? "Juist! 🎉" : mine !== null ? "Helaas." : "Geen antwoord.";

  // Duiding van de host
  const uitleg = (room.question?.uitleg || "").trim();
  const el = $("puitleg");
  if (uitleg) {
    el.innerHTML = `<strong>${esc(uitleg)}</strong>`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

/* ---------- Einde ---------- */

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

  await drawCard($("card"), {
    name: playerName,
    score: me.score,
    rank: rank || list.length || 1,
    total: list.length,
    title: cfg.game_title,
    url: base,
    accent: cfg.accent,
  });

  $("btn-download").onclick = () => downloadCard($("card"));
  $("btn-share").onclick = () => shareCard($("card"), `${playerName} — ${me.score} punten in ${cfg.game_title}`);
}

/* ---------- Start ---------- */

loadBrand({ subscribe: true });
