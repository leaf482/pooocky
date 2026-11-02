import { cardParts } from "./cards.js";
import { drawChart } from "./chart.js";
import { PokerEngine, streetLabel } from "./engine.js";
import { decideMinimax } from "./agent.js";
import { estimateEquity } from "./equity.js";
import { PARAM_KEYS, PARAM_META, cloneParams } from "./params.js";
import {
  allPresets,
  loadUserPresets,
  newPresetId,
  normalizePreset,
  saveUserPresets,
} from "./presets.js";
import { rankPresets, trainLadder } from "./ladder.js";
import { mulberry32 } from "./rng.js";
import { trainCompetition } from "./trainer.js";

const SPEED_MS = { slow: 700, normal: 260, fast: 60, instant: 0 };

const state = {
  userPresets: loadUserPresets(),
  presets: [],
  editorId: "minimax-base",
  draft: null,
  seats: [
    { presetId: "minimax-base", name: "Baseline", params: null, algorithm: "minimax" },
    { presetId: "minimax-tight", name: "Tight", params: null, algorithm: "minimax" },
  ],
  reveal: true,
  speed: "normal",
  running: false,
  training: false,
  ladder: false,
  stopTrain: false,
  resetPending: false,
  profitSeries: [],
  growthA: [],
  growthB: [],
  log: [],
  equity: [null, null],
  bubbles: ["", ""],
  banner: "Start a match to seat both AIs.",
  trainPhase: "Idle",
};

let engine = new PokerEngine({ seed: (Math.random() * 0x100000000) >>> 0 });
let loopOn = false;

function refreshPresets() {
  state.presets = allPresets(state.userPresets);
}

function presetById(id) {
  return state.presets.find((preset) => preset.id === id) || null;
}

function sameParams(a, b) {
  return PARAM_KEYS.every((key) => Math.abs(a[key] - b[key]) < 0.001);
}

refreshPresets();
state.seats[0].params = cloneParams(presetById("minimax-base").params);
state.seats[1].params = cloneParams(presetById("minimax-tight").params);
state.draft = {
  name: "Baseline",
  params: cloneParams(state.seats[0].params),
  algorithm: "minimax",
};

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function chip(n) {
  return Math.round(n).toLocaleString("en-US");
}

function signedBb(chips) {
  const value = chips / engine.bb;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cardHTML(id, hidden) {
  if (id == null) return `<i class="card empty"></i>`;
  if (hidden) return `<i class="card back" aria-hidden="true"></i>`;
  const card = cardParts(id);
  const red = card.red ? " red" : "";
  return `<i class="card${red}" aria-label="${card.text}"><b>${card.rankLabel}</b><em>${card.suitLabel}</em></i>`;
}

function hiddenCards() {
  return !state.reveal && engine.street !== "complete";
}

function paintStats() {
  const live = engine.street !== "idle" && engine.street !== "complete";
  const hands = engine.handsPlayed + (live ? 1 : 0);
  const items = [
    ["Hands", hands.toLocaleString("en-US")],
    ["AI A", `${signedBb(engine.profit[0])} bb`],
    ["AI B", `${signedBb(engine.profit[1])} bb`],
    ["Sessions", `${engine.sessionWins[0]}–${engine.sessionWins[1]}`],
  ];
  $("statbar").innerHTML = items
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
}

function paintTable() {
  for (let seat = 0; seat < 2; seat++) {
    const node = $(`seat-${seat}`);
    const active = engine.street !== "idle" && engine.street !== "complete" && engine.toAct === seat;
    node.classList.toggle("active", active);
    const holes = engine.hand ? engine.hand[seat].hole : [];
    const holeHTML = [0, 1]
      .map((index) => cardHTML(holes[index], hiddenCards() || holes[index] == null))
      .join("");
    const eq = state.equity[seat];
    node.innerHTML = `
      <div class="who">
        <div class="id">
          <strong>AI ${seat === 0 ? "A" : "B"}</strong>
          <span class="pname">${esc(state.seats[seat].name)}</span>
        </div>
        <span class="stack">${chip(engine.players[seat].stack)}</span>
      </div>
      <div class="holes">${holeHTML}</div>
      <div class="bubble">${esc(state.bubbles[seat] || "")}</div>
      <div class="eq">${eq == null ? "" : `${Math.round(eq * 100)}% vs ${state.seats[seat].algorithm === "range" ? "range" : "random"}`}</div>
    `;
  }
  const board = engine.board || [];
  $("board").innerHTML = [0, 1, 2, 3, 4].map((index) => cardHTML(board[index], false)).join("");
  if (!engine.hand || engine.street === "idle") $("pot").textContent = "Pot —";
  else if (engine.street === "complete") $("pot").textContent = "Settled";
  else $("pot").textContent = `Pot ${chip(engine.totalPot())} · ${streetLabel(engine.street)}`;
  $("banner").textContent = state.banner;
  const log = $("log");
  log.innerHTML = state.log.length
    ? state.log
        .map((line) => {
          const marker = /^(Flop|Turn|River)$/.test(line) ? " marker" : "";
          return `<p class="${marker.trim()}">${esc(line)}</p>`;
        })
        .join("")
    : `<p class="empty">Actions appear here.</p>`;
  log.scrollTop = log.scrollHeight;
}

function paintControls() {
  $("btn-run").textContent = state.running ? "Pause" : "Start";
  $("btn-run").disabled = state.training;
  $("btn-step").disabled = state.running || state.training;
  $("btn-reset").disabled = state.training;
  $("btn-train").disabled = state.training;
  $("btn-ladder").disabled = state.training;
  $("btn-stop").disabled = !state.training;
  for (const button of $("speeds").querySelectorAll("button")) {
    button.classList.toggle("on", button.dataset.speed === state.speed);
  }
}

function paintCharts() {
  drawChart($("match-chart"), [{ name: "AI A", color: "#ffffff", data: state.profitSeries }], {
    empty: "No hands yet",
  });
  drawChart(
    $("growth-chart"),
    [
      { name: "A", color: "#ffffff", data: state.growthA },
      { name: "B", color: "rgba(255,255,255,0.45)", data: state.growthB },
    ],
    { empty: "No generations yet" },
  );
}

function paintTrain() {
  $("train-status").textContent = state.trainPhase;
}

function styleBits(params) {
  const safe = params || {};
  const num = (key) => (Number.isFinite(safe[key]) ? safe[key].toFixed(2) : "—");
  return [
    ["Tight", num("tightness")],
    ["Aggr", num("aggression")],
    ["Bluff", num("bluff")],
  ];
}

function presetLabel(preset) {
  const dupes = state.presets.filter((item) => item.name === preset.name);
  if (dupes.length < 2) return preset.name;
  if (preset.builtin) return `${preset.name} · built-in`;
  return `${preset.name} · ${preset.id.slice(-4)}`;
}

function paintSeats() {
  const options = (selected) =>
    state.presets
      .map((preset) => {
        const on = preset.id === selected ? " selected" : "";
        return `<option value="${esc(preset.id)}"${on}>${esc(presetLabel(preset))}</option>`;
      })
      .join("");
  $("seat-panel").innerHTML = `
    <h2>Seats</h2>
    ${[0, 1]
      .map((seat) => {
        const letter = seat === 0 ? "A" : "B";
        const current = state.seats[seat];
        const known = presetById(current.presetId);
        const custom = !known || !sameParams(known.params, current.params) || known.algorithm !== current.algorithm;
        const seated = custom ? `${current.name} · edited` : current.name;
        const bits = styleBits(current.params)
          .map(([label, value]) => `<span><i>${label}</i><b>${value}</b></span>`)
          .join("");
        return `
          <div class="seat-box">
            <header><strong>AI ${letter}</strong><span title="${esc(current.name)}">${esc(seated)}</span></header>
            <select data-seat="${seat}" aria-label="AI ${letter} preset">
              ${custom ? `<option value="" selected>${esc(seated)}</option>` : ""}
              ${options(custom ? "" : current.presetId)}
            </select>
            <p class="algo-tag">${current.algorithm === "range" ? "Range" : "Minimax"}</p>
            <p class="spec">${bits}</p>
          </div>`;
      })
      .join("")}
  `;
}

function paintEditor() {
  const selected = presetById(state.editorId);
  const rows = state.presets
    .map((preset) => {
      const stat = preset.stats && Number.isFinite(preset.stats.ref)
        ? `<small>${preset.stats.ref >= 0 ? "+" : ""}${preset.stats.ref.toFixed(1)} bb/100 vs baseline</small>`
        : `<small>${esc(preset.blurb || "")}</small>`;
      return `<button type="button" class="row${preset.id === state.editorId ? " selected" : ""}" data-act="pick" data-id="${esc(preset.id)}"><b>${esc(presetLabel(preset))}</b>${stat}</button>`;
    })
    .join("");
  const sliders = PARAM_META.map((meta) => {
    const value = state.draft.params[meta.key];
    return `
      <label class="slider">
        <span>${meta.label}</span>
        <input type="range" min="${meta.min}" max="${meta.max}" step="${meta.step}" value="${value}" data-param="${meta.key}" />
        <span data-val="${meta.key}">${Number(value).toFixed(2)}</span>
      </label>`;
  }).join("");
  $("editor-panel").innerHTML = `
    <h2>Presets</h2>
    <p class="hint">${esc(selected?.blurb || "Tune the numbers, then seat the result.")}</p>
    <div class="list">${rows}</div>
    <input id="preset-name" maxlength="32" value="${esc(state.draft.name)}" aria-label="Preset name" />
    <label class="algo">Algorithm
      <select id="draft-algo" aria-label="Algorithm">
        <option value="minimax"${state.draft.algorithm === "range" ? "" : " selected"}>Minimax</option>
        <option value="range"${state.draft.algorithm === "range" ? " selected" : ""}>Range</option>
      </select>
    </label>
    ${sliders}
    <div class="actions">
      <button type="button" data-act="apply" data-seat="0">Seat A</button>
      <button type="button" data-act="apply" data-seat="1">Seat B</button>
      <button type="button" class="primary" data-act="save">Save</button>
    </div>
    <div class="actions quiet">
      <button type="button" data-act="export">Export</button>
      <button type="button" data-act="import">Import</button>
      <button type="button" data-act="delete" ${selected?.builtin ? "disabled" : ""}>Delete</button>
    </div>
    <input id="import-file" type="file" accept="application/json,.json" hidden />
  `;
}

function paintAll() {
  paintStats();
  paintTable();
  paintControls();
  paintCharts();
}

function pushLog(line) {
  state.log.push(line);
  state.log = state.log.slice(-24);
}

function onHandComplete() {
  const result = engine.result;
  const who = result.winner < 0 ? "Split" : result.winner === 0 ? "AI A" : "AI B";
  state.banner = result.winner < 0 ? `Split · ${result.title}` : `${who} wins · ${result.title}`;
  if (result.sessionWinner === 0) state.banner += " · AI A takes the session";
  if (result.sessionWinner === 1) state.banner += " · AI B takes the session";
  state.profitSeries.push(engine.profit[0] / engine.bb);
  if (state.profitSeries.length > 2000) {
    state.profitSeries = state.profitSeries.filter((_, index) => index % 2 === 0);
  }
  pushLog(`${state.banner} · A ${signedBb(result.deltas[0])} bb`);
}

function playOneAction() {
  if (engine.street === "idle" || engine.street === "complete") {
    engine.players[0].name = "AI A";
    engine.players[1].name = "AI B";
    engine.startHand();
    state.bubbles = ["", ""];
    state.equity = [null, null];
    state.banner = `Hand ${engine.handsPlayed + 1} · ${streetLabel(engine.street)}`;
    pushLog(state.banner);
    return;
  }
  const seat = engine.toAct;
  const view = engine.buildView(seat);
  if (!view) return;
  const streetBefore = engine.street;
  const samples = state.speed === "instant" ? 8 : 16;
  view.equity = estimateEquity(state.seats[seat].algorithm, view.hole, view.board, samples, engine.rng);
  const action = decideMinimax(view, state.seats[seat].params, engine.rng);
  const rec = engine.apply(seat, action);
  const bubble = (rec.text || "").replace(/^AI [AB]\s/, "");
  pushLog(rec.text || "");
  if (engine.street === "complete") {
    state.bubbles = ["", ""];
    state.equity = [null, null];
    onHandComplete();
    return;
  }
  if (engine.street !== streetBefore) {
    state.bubbles = ["", ""];
    state.equity = [null, null];
    pushLog(streetLabel(engine.street));
    state.banner = streetLabel(engine.street);
    return;
  }
  state.bubbles = ["", ""];
  state.bubbles[seat] = bubble;
  state.equity = [null, null];
  state.equity[seat] = view.equity;
  state.banner = `${streetLabel(streetBefore)} · ${bubble}`;
}

async function runLoop() {
  if (loopOn || state.training) return;
  loopOn = true;
  state.running = true;
  paintControls();
  let batch = 0;
  try {
    while (state.running && !state.resetPending) {
      playOneAction();
      if (state.speed === "step") {
        state.running = false;
        break;
      }
      if (state.speed === "instant") {
        batch += 1;
        if (batch >= 20) {
          batch = 0;
          paintStats();
          paintTable();
          paintCharts();
          await sleep(0);
        }
      } else {
        paintStats();
        paintTable();
        if (engine.street === "complete") paintCharts();
        await sleep(SPEED_MS[state.speed] ?? 260);
      }
    }
  } catch (error) {
    state.banner = error.message || "Match error";
    state.running = false;
    console.error(error);
  }
  if (state.resetPending) applyReset();
  paintAll();
  loopOn = false;
  paintControls();
}

function toggleRun() {
  if (state.training) return;
  if (state.running) {
    state.running = false;
    paintControls();
    return;
  }
  if (state.speed === "step") {
    playOneAction();
    paintAll();
    return;
  }
  runLoop();
}

function applyReset() {
  state.resetPending = false;
  state.running = false;
  engine.reset();
  state.profitSeries = [];
  state.log = [];
  state.equity = [null, null];
  state.bubbles = ["", ""];
  state.banner = "Session reset. Presets kept.";
}

function requestReset() {
  if (state.training) return;
  state.resetPending = true;
  state.running = false;
  if (!loopOn) {
    applyReset();
    paintAll();
  }
}

function applyPresetToSeat(seat, id) {
  const preset = presetById(id);
  if (!preset || (seat !== 0 && seat !== 1)) return false;
  state.seats[seat] = {
    presetId: preset.id,
    name: preset.name,
    params: cloneParams(preset.params),
    algorithm: preset.algorithm === "range" ? "range" : "minimax",
  };
  return true;
}

function readDraftFromInputs() {
  const name = $("preset-name");
  if (name) state.draft.name = name.value.trim().slice(0, 32) || "Unnamed preset";
  const algo = $("draft-algo");
  if (algo) state.draft.algorithm = algo.value === "range" ? "range" : "minimax";
}

function applyDraft(seat) {
  readDraftFromInputs();
  const matched = state.presets.find(
    (preset) =>
      sameParams(preset.params, state.draft.params) &&
      preset.name === state.draft.name &&
      preset.algorithm === state.draft.algorithm,
  );
  state.seats[seat] = {
    presetId: matched ? matched.id : "",
    name: state.draft.name,
    params: cloneParams(state.draft.params),
    algorithm: state.draft.algorithm === "range" ? "range" : "minimax",
  };
  paintSeats();
  paintTable();
}

function saveDraft() {
  readDraftFromInputs();
  const preset = normalizePreset({
    name: state.draft.name,
    params: state.draft.params,
    algorithm: state.draft.algorithm,
    origin: "user",
    blurb: state.draft.algorithm === "range" ? "Hand-tuned range search." : "Hand-tuned minimax parameters.",
  });
  if (!preset) return;
  state.userPresets.push(preset);
  state.userPresets = saveUserPresets(state.userPresets);
  refreshPresets();
  state.editorId = preset.id;
  paintEditor();
  paintSeats();
}

function deleteSelected() {
  const preset = presetById(state.editorId);
  if (!preset || preset.builtin) return;
  state.userPresets = state.userPresets.filter((item) => item.id !== preset.id);
  state.userPresets = saveUserPresets(state.userPresets);
  refreshPresets();
  state.editorId = "minimax-base";
  state.draft = { name: "Baseline", params: cloneParams(presetById("minimax-base").params), algorithm: "minimax" };
  paintEditor();
  paintSeats();
}

function exportPresets() {
  readDraftFromInputs();
  const presets = state.userPresets.length
    ? state.userPresets
    : [normalizePreset({ name: state.draft.name, params: state.draft.params, origin: "user" })];
  const blob = new Blob([JSON.stringify({ version: 1, presets }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = "pooocky-presets.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function importPresets(file) {
  if (!file || file.size > 200_000) throw new Error("too large");
  const data = JSON.parse(await file.text());
  const rawList = Array.isArray(data) ? data : data && typeof data === "object" ? data.presets : null;
  if (!Array.isArray(rawList)) throw new Error("Preset list is missing");
  let added = 0;
  for (const raw of rawList.slice(0, 40)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const preset = normalizePreset({
      name: raw.name,
      params: raw.params,
      algorithm: raw.algorithm,
      blurb: raw.blurb,
      origin: raw.origin,
      generation: raw.generation,
      stats: raw.stats,
      id: newPresetId(),
    });
    if (!preset) continue;
    state.userPresets.push(preset);
    added += 1;
  }
  if (!added) throw new Error("Preset list is missing");
  state.userPresets = saveUserPresets(state.userPresets);
  refreshPresets();
  const last = state.userPresets[state.userPresets.length - 1];
  if (last) {
    state.editorId = last.id;
    state.draft = { name: last.name, params: cloneParams(last.params), algorithm: last.algorithm };
  }
  paintEditor();
  paintSeats();
  state.trainPhase = `Imported ${added} preset${added === 1 ? "" : "s"}.`;
  paintTrain();
}

function rememberGrowth(history) {
  state.growthA = history.map((item) => item.a?.ref).filter((value) => Number.isFinite(value));
  state.growthB = history.map((item) => item.b?.ref).filter((value) => Number.isFinite(value));
}

function adoptTrained(side, params, score, gen) {
  const seat = side === "A" ? 0 : 1;
  const ref = score && Number.isFinite(score.ref) ? score.ref : null;
  const algorithm = state.seats[seat].algorithm === "range" ? "range" : "minimax";
  const preset = normalizePreset({
    name: `${side} gen ${gen}`,
    params,
    algorithm,
    origin: "train",
    generation: gen,
    blurb: ref == null ? "Trained parameters." : `${ref >= 0 ? "+" : ""}${ref.toFixed(1)} bb/100 vs baseline`,
    stats: score ? { ref: score.ref, h2h: score.h2h } : null,
  });
  state.userPresets.push(preset);
  state.seats[seat] = { presetId: preset.id, name: preset.name, params: cloneParams(params), algorithm };
  return preset;
}

function formatRemaining(deadline) {
  const ms = Math.max(0, deadline - Date.now());
  const total = Math.ceil(ms / 60000);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

function seatLadder(champion) {
  const preset = normalizePreset({
    name: `${champion.name} ladder ${champion.generation}`,
    params: champion.params,
    algorithm: champion.algorithm,
    origin: "train",
    generation: champion.generation,
    blurb: `Ladder champion after ${champion.generation} confirmed promotion${champion.generation === 1 ? "" : "s"}.`,
  });
  if (!preset) return null;
  state.userPresets.push(preset);
  state.userPresets = saveUserPresets(state.userPresets);
  refreshPresets();
  const saved = state.userPresets.find((item) => item.id === preset.id) || preset;
  state.seats[0] = {
    presetId: saved.id,
    name: saved.name,
    params: cloneParams(champion.params),
    algorithm: saved.algorithm === "range" ? "range" : "minimax",
  };
  state.editorId = saved.id;
  state.draft = {
    name: saved.name,
    params: cloneParams(champion.params),
    algorithm: state.seats[0].algorithm,
  };
  return saved;
}

function readTrainInt(id, fallback, min, max) {
  const raw = String($(id)?.value ?? "").trim();
  if (!raw) return fallback;
  const value = Math.round(Number(raw));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

async function startTraining() {
  if (state.training) return;
  state.running = false;
  while (loopOn) await sleep(30);
  state.training = true;
  state.stopTrain = false;
  state.trainPhase = "Preparing training";
  paintControls();
  paintTrain();
  const rng = mulberry32((Math.random() * 0x100000000) >>> 0);
  try {
    const result = await trainCompetition({
      paramsA: state.seats[0].params,
      paramsB: state.seats[1].params,
      generations: readTrainInt("gen", 6, 1, 24),
      population: readTrainInt("pop", 3, 2, 5),
      pairs: readTrainInt("pairs", 24, 8, 80),
      samples: 6,
      algorithmA: state.seats[0].algorithm,
      algorithmB: state.seats[1].algorithm,
      rng,
      shouldStop: () => state.stopTrain,
      onProgress: (info) => {
        rememberGrowth(info.history);
        const a = info.a ? `A ${info.a.ref >= 0 ? "+" : ""}${info.a.ref.toFixed(0)}` : "A …";
        const b = info.b ? `B ${info.b.ref >= 0 ? "+" : ""}${info.b.ref.toFixed(0)}` : "B …";
        state.trainPhase = `Gen ${info.gen}/${info.total} · ${info.phase} · ${a} · ${b} bb/100`;
        paintTrain();
        paintCharts();
      },
    });
    const last = result.history[result.history.length - 1];
    if (last && last.gen > 0) {
      adoptTrained("A", result.paramsA, last.a, last.gen);
      adoptTrained("B", result.paramsB, last.b, last.gen);
      state.userPresets = saveUserPresets(state.userPresets);
      refreshPresets();
      state.editorId = state.seats[0].presetId;
      state.draft = {
        name: state.seats[0].name,
        params: cloneParams(state.seats[0].params),
        algorithm: state.seats[0].algorithm,
      };
      state.trainPhase = state.stopTrain
        ? "Stopped. Locked generations are seated."
        : `Saved through generation ${last.gen} and seated both players.`;
      paintEditor();
      paintSeats();
      paintTable();
    } else if (state.stopTrain) {
      state.trainPhase = "Stopped before a generation was locked. Seats unchanged.";
    }
  } catch (error) {
    state.trainPhase = error.message || "Training error";
    console.error(error);
  }
  state.training = false;
  paintControls();
  paintTrain();
  paintCharts();
}

async function startLadder() {
  if (state.training) return;
  state.running = false;
  while (loopOn) await sleep(30);
  state.training = true;
  state.ladder = true;
  state.stopTrain = false;
  state.trainPhase = "Ranking presets";
  paintControls();
  paintTrain();
  const rng = mulberry32((Math.random() * 0x100000000) >>> 0);
  try {
    await sleep(0);
    const pairs = readTrainInt("pairs", 24, 8, 80);
    const ranked = rankPresets(state.presets, { pairs, samples: 4, rng });
    const champ = ranked.champion;
    if (state.stopTrain) {
      state.trainPhase = "Stopped before the ladder started.";
    } else if (!champ) {
      state.trainPhase = "No preset to rank.";
    } else {
      const hours = readTrainInt("hours", 1, 1, 12);
      const result = await trainLadder({
        champion: champ,
        hours,
        population: readTrainInt("pop", 3, 2, 5),
        pairs,
        samples: 4,
        rng,
        shouldStop: () => state.stopTrain,
        onProgress: (info) => {
          const name = info.champion?.name || "Champion";
          const algo = info.champion?.algorithm === "range" ? "Range" : "Minimax";
          state.trainPhase = `${formatRemaining(info.deadline)} · ${name} · ${algo} · ${info.promotions} promotion${info.promotions === 1 ? "" : "s"} · ${info.phase}`;
          paintTrain();
        },
      });
      if (result.promotions > 0) {
        const saved = seatLadder(result.champion);
        state.trainPhase = state.stopTrain
          ? `Stopped. ${saved?.name || "Champion"} is seated.`
          : `Saved ${saved?.name || "Champion"} and seated it.`;
        paintEditor();
        paintSeats();
        paintTable();
      } else if (state.stopTrain) {
        state.trainPhase = `Stopped. ${result.champion.name} held.`;
      } else {
        state.trainPhase = `${result.champion.name} held for ${hours}h.`;
      }
    }
  } catch (error) {
    state.trainPhase = error.message || "Ladder error";
    console.error(error);
  }
  state.training = false;
  state.ladder = false;
  paintControls();
  paintTrain();
}

function bind() {
  $("btn-run").addEventListener("click", toggleRun);
  $("btn-step").addEventListener("click", () => {
    if (state.running || state.training) return;
    playOneAction();
    paintAll();
  });
  $("btn-reset").addEventListener("click", requestReset);
  $("reveal").addEventListener("change", (event) => {
    state.reveal = event.target.checked;
    paintTable();
  });
  $("speeds").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.speed = button.dataset.speed;
    paintControls();
  });
  $("seat-panel").addEventListener("change", (event) => {
    const seat = Number(event.target.dataset.seat);
    if (seat !== 0 && seat !== 1) return;
    if (!event.target.value) {
      paintSeats();
      return;
    }
    applyPresetToSeat(seat, event.target.value);
    paintSeats();
    paintTable();
  });
  $("editor-panel").addEventListener("input", (event) => {
    const key = event.target.dataset.param;
    if (!key) return;
    state.draft.params[key] = Number(event.target.value);
    const label = event.target.parentElement.querySelector(`[data-val="${key}"]`);
    if (label) label.textContent = Number(event.target.value).toFixed(2);
  });
  $("editor-panel").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-act]");
    if (!button) return;
    const act = button.dataset.act;
    if (act === "pick") {
      const preset = presetById(button.dataset.id);
      if (!preset) return;
      state.editorId = preset.id;
      state.draft = { name: preset.name, params: cloneParams(preset.params), algorithm: preset.algorithm };
      paintEditor();
    } else if (act === "apply") {
      applyDraft(Number(button.dataset.seat));
    } else if (act === "save") {
      saveDraft();
    } else if (act === "delete") {
      deleteSelected();
    } else if (act === "export") {
      exportPresets();
    } else if (act === "import") {
      $("import-file").click();
    }
  });
  $("editor-panel").addEventListener("change", async (event) => {
    if (event.target.id === "draft-algo") {
      state.draft.algorithm = event.target.value === "range" ? "range" : "minimax";
      return;
    }
    if (event.target.id !== "import-file" || !event.target.files[0]) return;
    try {
      await importPresets(event.target.files[0]);
    } catch (error) {
      state.trainPhase = "Import failed. Use a JSON preset file.";
      paintTrain();
    }
    event.target.value = "";
  });
  $("btn-train").addEventListener("click", startTraining);
  $("btn-ladder").addEventListener("click", startLadder);
  $("btn-stop").addEventListener("click", () => {
    state.stopTrain = true;
    state.trainPhase = state.ladder ? "Stopping after this step." : "Stopping after this candidate.";
    paintTrain();
  });
  window.addEventListener("keydown", (event) => {
    if (event.target.closest("input, textarea, select")) return;
    if (event.code === "Space") {
      event.preventDefault();
      toggleRun();
    }
  });
  window.addEventListener("resize", paintCharts);
  window.addEventListener("error", (event) => {
    if (event.target && event.target !== window) return;
    if (!event.message) return;
    state.banner = event.message;
    paintTable();
  });
}

bind();
paintSeats();
paintEditor();
paintTrain();
paintAll();
