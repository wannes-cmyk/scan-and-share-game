import { sb, esc } from "./supabase-client.js";
import { loadBrand, config } from "./brand.js";
import QRCode from "https://esm.sh/qrcode@1.5.3";

const $ = (id) => document.getElementById(id);
const LETTERS = "ABCD";

let HOST_KEY = localStorage.getItem("host_key") || "";
let roomId = null;
let questions = [];
let qIndex = 0;
let players = [];
let channel = null;
let timerHandle = null;

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  $(id).classList.remove("hidden");
}

function joinUrl() {
  const u = new URL("play.html", location.href);
  u.searchParams.set("room", roomId);
  return u.toString();
}

/* ---------- Setup ---------- */

$("btn-start").onclick = async () => {
  const key = $("hostkey").value.trim() || HOST_KEY;
  $("setup-error").textContent = "";
  try {
    const { data, error } = await sb.rpc("get_questions", { p_host_key: key });
    if (error) throw error;
    if (!data || !data.length) throw new Error("Geen vragen gevonden. Voeg er toe via 'Vragen beheren'.");
    questions = data;
    HOST_KEY = key;
    localStorage.setItem("host_key", key);
    const r = await sb.rpc("host_create_room", { p_host_key: key });
    if (r.error) throw r.error;
    roomId = r.data;
    startLobby();
  } catch (e) {
    $("setup-error").textContent = "Mislukt: " + (e.message || e);
  }
};

/* ---------- Lobby ---------- */

async function startLobby() {
  show("lobby");
  $("roomcode").textContent = roomId;
  const url = joinUrl();
  $("joinurl").textContent = url;
  const qrHost = $("qr");
  qrHost.innerHTML = "";
  const qrCanvas = document.createElement("canvas");
  qrHost.appendChild(qrCanvas);
  QRCode.toCanvas(qrCanvas, url, { width: 320, margin: 1 }, () => {});
  await refreshPlayers();
  subscribe();
}

function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb
    .channel("host-" + roomId)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
      () => refreshPlayers())
    .on("postgres_changes",
      { event: "*", schema: "public", table: "answers", filter: `room_id=eq.${roomId}` },
      () => { if (!$("histogram").classList.contains("hidden")) renderHistogram(); })
    .subscribe();
}

async function refreshPlayers() {
  const { data } = await sb
    .from("players")
    .select("id,name,score")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });
  players = data || [];
  $("playercount").textContent = players.length;
  $("playerlist").innerHTML = players.map((p) => `<li>${esc(p.name)}</li>`).join("");
  renderBoard($("boardend"), players);
}

function renderBoard(el, list) {
  const sorted = [...list].sort((a, b) => b.score - a.score);
  el.innerHTML = sorted
    .map((p, i) => `<li><span>${i + 1}. ${esc(p.name)}</span><span class="pts">${p.score}</span></li>`)
    .join("");
}

/* ---------- Vraag / reveal ---------- */

$("btn-question").onclick = () => startQuestion(0);

async function startQuestion(i) {
  qIndex = i;
  const q = questions[i];
  const seconds = Number(config().answer_seconds) || 20;
  const { error } = await sb.rpc("host_set_question", {
    p_host_key: HOST_KEY, p_room_id: roomId, p_index: q.idx, p_seconds: seconds,
  });
  if (error) { alert("Fout: " + error.message); return; }
  show("quiz");
  renderQuestion(q);
  startTimer(seconds);
}

function renderQuestion(q) {
  $("qnum").textContent = `Vraag ${qIndex + 1} / ${questions.length}`;
  $("qvraag").textContent = q.vraag;
  $("qopties").innerHTML = q.opties
    .map((o, i) => `<div class="optie"><b>${LETTERS[i]}</b><span>${esc(o)}</span></div>`)
    .join("");
  $("histogram").classList.add("hidden");
  $("histogram").innerHTML = "";
  $("uitleg").classList.add("hidden");
  $("uitleg").innerHTML = "";
  $("btn-reveal").classList.remove("hidden");
  $("btn-next").classList.add("hidden");
}

function startTimer(seconds) {
  clearInterval(timerHandle);
  const end = Date.now() + seconds * 1000;
  const tick = () => {
    const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    $("timer").textContent = left + "s";
    if (left <= 0) clearInterval(timerHandle);
  };
  tick();
  timerHandle = setInterval(tick, 250);
}

$("btn-reveal").onclick = async () => {
  clearInterval(timerHandle);
  $("timer").textContent = "0s";
  const { error } = await sb.rpc("host_reveal", { p_host_key: HOST_KEY, p_room_id: roomId });
  if (error) { alert("Fout: " + error.message); return; }

  const q = questions[qIndex];
  const heeftJuist = q.juist !== null && q.juist !== undefined;

  [...$("qopties").children].forEach((el, i) => {
    if (!heeftJuist) return;  // peiling: niets is goed of fout
    el.classList.add(i === q.juist ? "juist" : "fout");
  });

  // Duiding
  const uitleg = (q.uitleg || "").trim();
  const el = $("uitleg");
  if (heeftJuist) {
    el.innerHTML = `<strong>${LETTERS[q.juist]}:</strong> ${esc(q.opties[q.juist])}${
      uitleg ? `<br><span class="muted">${esc(uitleg)}</span>` : ""
    }`;
  } else {
    el.innerHTML = `<em>Peiling — geen juist antwoord.${uitleg ? "" : " Kijk naar de verdeling."}</em>${
      uitleg ? `<br><span class="muted">${esc(uitleg)}</span>` : ""
    }`;
  }
  el.classList.remove("hidden");

  await renderHistogram();
  $("btn-reveal").classList.add("hidden");
  const next = $("btn-next");
  next.classList.remove("hidden");
  next.textContent = qIndex + 1 < questions.length ? "Volgende vraag" : "Eindstand";
};

async function renderHistogram() {
  const q = questions[qIndex];
  const { data } = await sb
    .from("answers")
    .select("choice")
    .eq("room_id", roomId)
    .eq("question_index", q.idx);

  const n = (q.opties || []).length;
  const counts = new Array(n).fill(0);
  (data || []).forEach((a) => { if (a.choice >= 0 && a.choice < n) counts[a.choice]++; });

  const total = counts.reduce((a, b) => a + b, 0);
  const heeftJuist = q.juist !== null && q.juist !== undefined;

  const kop = total
    ? `${total} van ${players.length} speler${players.length === 1 ? "" : "s"} koos`
    : "Nog geen antwoorden";

  const bars = counts
    .map((c, i) => {
      const pct = total ? Math.round((c / total) * 100) : 0;
      const juist = heeftJuist && i === q.juist;
      return `<div class="bar${juist ? " correct" : ""}">
        <div class="fill" style="width:${pct}%"></div>
        <span>${LETTERS[i]}${juist ? " ✓" : ""} — ${c} (${pct}%)</span>
      </div>`;
    })
    .join("");

  $("histogram").innerHTML = `<p class="muted small">${kop}</p>${bars}`;
  $("histogram").classList.remove("hidden");
}

$("btn-next").onclick = async () => {
  if (qIndex + 1 < questions.length) {
    startQuestion(qIndex + 1);
  } else {
    await sb.rpc("host_set_state", { p_host_key: HOST_KEY, p_room_id: roomId, p_state: "end" });
    await refreshPlayers();
    show("end");
  }
};

$("btn-newgame").onclick = async () => {
  clearInterval(timerHandle);
  const r = await sb.rpc("host_create_room", { p_host_key: HOST_KEY });
  if (r.error) { alert("Fout: " + r.error.message); return; }
  roomId = r.data;
  qIndex = 0;
  startLobby();
};

/* ---------- Start ---------- */

loadBrand({ subscribe: true });
