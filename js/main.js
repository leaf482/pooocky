import { cardParts } from "./cards.js";
import { drawChart } from "./chart.js";
import { PokerEngine, streetLabel } from "./engine.js";
import { decideMinimax } from "./agent.js";
import { monteCarloEquity } from "./equity.js";
import { PARAM_KEYS, PARAM_META, cloneParams } from "./params.js";
import {
  allPresets,
  loadUserPresets,
  newPresetId,
  normalizePreset,
  saveUserPresets,
} from "./presets.js";
import { mulberry32 } from "./rng.js";
import { trainCompetition } from "./trainer.js";

const SPEED_MS = { slow: 700, normal: 260, fast: 60, instant: 0 };

const state = {
  userPresets: loadUserPresets(),
  presets: [],
  editorId: "minimax-base",
  draft: null,
  seats: [
    { presetId: "minimax-base", name: "Baseline", params: null },
    { presetId: "minimax-tight", name: "Tight", params: null },
  ],
  reveal: true,
  speed: "normal",
  running: false,
  training: false,
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
  const sessions = engine.sessionWins[0] + engine.sessionWins[1];
  const items = [
    ["Hands", engine.handsPlayed.toLocaleString("en-US")],
    ["AI A", `${signedBb(engine.profit[0])} bb`],
    ["AI B", `${signedBb(engine.profit[1])} bb`],
    ["Sessions", `${engine.sessionWins[0]}–${engine.sessionWins[1]}`],
  ];
  $("statbar").innerHTML = items
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
    .join("");
  if (!sessions && engine.handsPlayed === 0) {
    $("statbar").querySelectorAll("dd")[3].textContent = "0–0";
  }
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
      <div class="eq">${eq == null ? "" : `Equity ${Math.round(eq * 100)}%`}</div>
    `;
  }
  const board = engine.board || [];
  $("board").innerHTML = [0, 1, 2, 3, 4].map((index) => cardHTML(board[index], false)).join("");
  if (!engine.hand || engine.street === "idle") $("pot").textContent = "Pot —";
  else if (engine.street === "complete") $("pot").textContent = "Settled";
  else $("pot").textContent = `Pot ${chip(engine.totalPot())} · ${streetLabel(engine.street)}`;
  $("banner").textContent = state.banner;
  $("log").innerHTML = state.log.length
    ? state.log.map((line) => `<p>${esc(line)}</p>`).join("")
    : `<p class="empty">Actions appear here.</p>`;
}

function paintControls() {
  $("btn-run").textContent = state.running ? "Pause" : "Start";
  $("btn-run").disabled = state.training;
  $("btn-step").disabled = state.running || state.training;
  $("btn-reset").disabled = state.training;
  $("btn-train").disabled = state.training;
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

function styleLine(params) {
  return `Tight ${params.tightness.toFixed(2)}  ·  Aggr ${params.aggression.toFixed(2)}  ·  Bluff ${params.bluff.toFixed(2)}`;
}

function paintSeats() {
  const options = (selected) =>
    state.presets
      .map((preset) => {
        const on = preset.id === selected ? " selected" : "";
        return `<option value="${esc(preset.id)}"${on}>${esc(preset.name)}</option>`;
      })
      .join("");
  $("seat-panel").innerHTML = `
    <h2>Seats</h2>
    ${[0, 1]
      .map((seat) => {
        const letter = seat === 0 ? "A" : "B";
        const current = state.seats[seat];
        const known = presetById(current.presetId);
        const custom = !known || !sameParams(known.params, current.params);
        return `
          <div class="seat-box">
            <header><strong>AI ${letter}</strong><span>${custom ? "Edited" : esc(current.name)}</span></header>
            <select data-seat="${seat}" aria-label="AI ${letter} preset">
              ${custom ? `<option value="" selected>Edited</option>` : ""}
              ${options(custom ? "" : current.presetId)}
            </select>
            <p class="tiny">${styleLine(current.params)}</p>
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
      return `<button type="button" class="row${preset.id === state.editorId ? " selected" : ""}" data-act="pick" data-id="${esc(preset.id)}"><b>${esc(preset.name)}</b>${stat}</button>`;
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
  state.log.unshift(line);
  state.log = state.log.slice(0, 16);
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
  const samples = state.speed === "instant" ? 8 : 16;
  view.equity = monteCarloEquity(view.hole, view.board, samples, engine.rng);
  state.equity[seat] = view.equity;
  const action = decideMinimax(view, state.seats[seat].params, engine.rng);
  const rec = engine.apply(seat, action);
  state.bubbles[seat] = (rec.text || "").replace(/^AI [AB]\s/, "");
  pushLog(rec.text || "");
  if (engine.street === "complete") onHandComplete();
  else state.banner = `${streetLabel(engine.street)} · ${state.bubbles[seat]}`;
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
  if (!preset) return;
  state.seats[seat] = {
    presetId: preset.id,
    name: preset.name,
    params: cloneParams(preset.params),
  };
}

function readDraftFromInputs() {
  const name = $("preset-name");
  if (name) state.draft.name = name.value.trim().slice(0, 32) || "Unnamed preset";
}

function applyDraft(seat) {
  readDraftFromInputs();
  const matched = state.presets.find((preset) => sameParams(preset.params, state.draft.params) && preset.name === state.draft.name);
  state.seats[seat] = {
    presetId: matched ? matched.id : "",
    name: state.draft.name,
    params: cloneParams(state.draft.params),
  };
  paintSeats();
  paintTable();
}

function saveDraft() {
  readDraftFromInputs();
  const preset = normalizePreset({
    name: state.draft.name,
    params: state.draft.params,
    origin: "user",
    blurb: "Hand-tuned minimax parameters.",
  });
  state.userPresets.push(preset);
  saveUserPresets(state.userPresets);
  refreshPresets();
  state.editorId = preset.id;
  paintEditor();
  paintSeats();
}

function deleteSelected() {
  const preset = presetById(state.editorId);
  if (!preset || preset.builtin) return;
  state.userPresets = state.userPresets.filter((item) => item.id !== preset.id);
  saveUserPresets(state.userPresets);
  refreshPresets();
  state.editorId = "minimax-base";
  state.draft = { name: "Baseline", params: cloneParams(presetById("minimax-base").params) };
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
  link.href = URL.createObjectURL(blob);
  link.download = "pooocky-presets.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importPresets(file) {
  const data = JSON.parse(await file.text());
  const list = Array.isArray(data) ? data : data.presets;
  if (!Array.isArray(list)) throw new Error("Preset list is missing");
  for (const raw of list) {
    const preset = normalizePreset({ ...raw, id: newPresetId(), builtin: false });
    if (preset) state.userPresets.push(preset);
  }
  state.userPresets = state.userPresets.slice(-40);
  saveUserPresets(state.userPresets);
  refreshPresets();
  const last = state.userPresets[state.userPresets.length - 1];
  if (last) {
    state.editorId = last.id;
    state.draft = { name: last.name, params: cloneParams(last.params) };
  }
  paintEditor();
  paintSeats();
  state.trainPhase = `Imported ${list.length} preset${list.length === 1 ? "" : "s"}.`;
  paintTrain();
}

function rememberGrowth(history) {
  state.growthA = history.map((item) => item.a?.ref).filter((value) => Number.isFinite(value));
  state.growthB = history.map((item) => item.b?.ref).filter((value) => Number.isFinite(value));
}

function adoptTrained(side, params, score, gen) {
  const ref = score && Number.isFinite(score.ref) ? score.ref : null;
  const preset = normalizePreset({
    name: `${side} gen ${gen}`,
    params,
    origin: "train",
    generation: gen,
    blurb: ref == null ? "Trained minimax parameters." : `${ref >= 0 ? "+" : ""}${ref.toFixed(1)} bb/100 vs baseline`,
    stats: score ? { ref: score.ref, h2h: score.h2h } : null,
  });
  state.userPresets.push(preset);
  const seat = side === "A" ? 0 : 1;
  state.seats[seat] = { presetId: preset.id, name: preset.name, params: cloneParams(params) };
  return preset;
}

function readTrainInt(id, fallback, min, max) {
  const value = Math.round(Number($(id).value));
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
      saveUserPresets(state.userPresets);
      refreshPresets();
      state.editorId = state.seats[0].presetId;
      state.draft = { name: state.seats[0].name, params: cloneParams(state.seats[0].params) };
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
    const seat = event.target.dataset.seat;
    if (seat == null || !event.target.value) return;
    applyPresetToSeat(Number(seat), event.target.value);
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
      state.draft = { name: preset.name, params: cloneParams(preset.params) };
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
  $("btn-stop").addEventListener("click", () => {
    state.stopTrain = true;
    state.trainPhase = "Stopping after this candidate.";
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
    state.banner = event.message || "Error";
    paintTable();
  });
}

bind();
paintSeats();
paintEditor();
paintTrain();
paintAll();
