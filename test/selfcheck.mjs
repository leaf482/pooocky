import { fileURLToPath } from "node:url";
import { handTitle, scoreCards } from "../js/eval.js";
import { PokerEngine } from "../js/engine.js";
import { decideMinimax } from "../js/agent.js";
import { handContinues } from "../js/equity.js";
import { duplicateMatch, oneHand, playHand } from "../js/play.js";
import { BASE_PARAMS, TIGHT_PARAMS, cloneParams } from "../js/params.js";
import { normalizePreset } from "../js/presets.js";
import { mulberry32 } from "../js/rng.js";
import { resolveStatic } from "../serve.mjs";
import { formatPace, geneTier, normalizeLadder, rankPresets, rememberChampion, trainLadder } from "../js/ladder.js";
import { leadsByNoise, trainCompetition } from "../js/trainer.js";

let failed = 0;

function assert(cond, message) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", message);
  }
}

function card(rank, suit) {
  return suit * 13 + "23456789TJQKA".indexOf(rank);
}

function act(engine, type) {
  const legal = engine.legal(engine.toAct);
  const action = legal.find((item) => item.type === type);
  if (!action) throw new Error(`${type} 없음 ${JSON.stringify(legal)} street=${engine.street}`);
  engine.apply(engine.toAct, action);
}

const royal = [card("A", 1), card("K", 1), card("Q", 1), card("J", 1), card("T", 1)];
const steelWheel = [card("A", 2), card("2", 2), card("3", 2), card("4", 2), card("5", 2)];
const quads = [card("A", 0), card("A", 1), card("A", 2), card("A", 3), card("K", 0)];
const acesFull = [card("A", 0), card("A", 1), card("A", 2), card("K", 0), card("K", 1)];
const kingsFull = [card("K", 0), card("K", 1), card("K", 2), card("A", 0), card("A", 1)];
const wheel = [card("A", 0), card("2", 1), card("3", 2), card("4", 3), card("5", 0)];
const sixHigh = [card("6", 0), card("5", 1), card("4", 2), card("3", 3), card("2", 0)];
const twoAces = [card("A", 0), card("A", 1), card("K", 2), card("Q", 3), card("2", 0)];
const twoKings = [card("K", 0), card("K", 1), card("Q", 2), card("J", 3), card("9", 0)];
const flush = [card("A", 0), card("J", 0), card("9", 0), card("7", 0), card("2", 0)];
const straight = [card("9", 1), card("8", 2), card("7", 3), card("6", 0), card("5", 1)];

assert(handTitle(royal) === "Royal flush", "royal flush name");
assert(scoreCards(royal) > scoreCards(steelWheel), "로열이 스틸휠보다 셈");
assert(scoreCards(steelWheel) > scoreCards(quads), "스트레이트 플러시가 포카드보다 셈");
assert(scoreCards(quads) > scoreCards(acesFull), "포카드가 풀하우스보다 셈");
assert(scoreCards(acesFull) > scoreCards(kingsFull), "에이스 풀이 킹 풀보다 셈");
assert(scoreCards(flush) > scoreCards(straight), "플러시가 스트레이트보다 셈");
assert(scoreCards(sixHigh) > scoreCards(wheel), "6 스트레이트가 휠보다 셈");
assert(scoreCards(twoAces) > scoreCards(twoKings), "에이스 페어가 킹 페어보다 셈");
assert(handTitle(wheel) === "Straight", "wheel is a straight");

const seven = [
  card("A", 1),
  card("K", 1),
  card("Q", 1),
  card("J", 1),
  card("T", 1),
  card("2", 0),
  card("3", 2),
];
assert(handTitle(seven) === "Royal flush", "best five of seven is a royal");

function checkDown(seed) {
  const engine = new PokerEngine({ seed, startStack: 1000, sb: 10, bb: 20 });
  const sum = engine.chipSum();
  engine.startHand();
  assert(engine.chipSum() === sum, "시작 칩 합");
  assert(engine.toAct === engine.button, "프리플랍 선액은 버튼");
  act(engine, "call");
  act(engine, "check");
  for (let street = 0; street < 3; street++) {
    assert(engine.street !== "complete", `스트리트 진행 ${street}`);
    act(engine, "check");
    act(engine, "check");
  }
  assert(engine.street === "complete", "체크다운 종료");
  assert(engine.chipSum() === sum, "체크다운 칩 보존");
  const stacks = [engine.players[0].stack, engine.players[1].stack].sort((a, b) => a - b);
  assert(stacks[0] === 980 && stacks[1] === 1020, `팟 40 정산 ${stacks}`);
  assert(engine.profit[0] + engine.profit[1] === 0, "수익 합 0");
}

checkDown(7);

{
  const engine = new PokerEngine({ seed: 3, startStack: 1000, sb: 10, bb: 20 });
  engine.startHand();
  const sb = engine.button;
  act(engine, "fold");
  assert(engine.street === "complete", "폴드 종료");
  assert(engine.result.winner === 1 - sb, "블라인드가 폴드 팟을 가져감");
  assert(engine.players[sb].stack === 990, `SB 스택 ${engine.players[sb].stack}`);
  assert(engine.players[1 - sb].stack === 1010, `BB 스택 ${engine.players[1 - sb].stack}`);
  assert(engine.chipSum() === 2000, "폴드 칩 보존");
}

{
  const engine = new PokerEngine({ seed: 9, startStack: 1000, sb: 10, bb: 20 });
  engine.startHand();
  act(engine, "allin");
  act(engine, "call");
  assert(engine.street === "complete", "올인 쇼다운");
  assert(engine.sessionWins[0] + engine.sessionWins[1] === 1, "세션 승자");
  assert(engine.players[0].stack === 1000 && engine.players[1].stack === 1000, "리바이");
  assert(Math.abs(engine.profit[0]) === 1000, `올인 손익 ${engine.profit[0]}`);
  assert(engine.chipSum() === 2000, "리바이 후 칩 합");
}

function randomHands(seed, hands, startStack) {
  const rng = mulberry32(seed);
  const engine = new PokerEngine({ seed, startStack, sb: 10, bb: 20 });
  const expected = startStack * 2;
  for (let h = 0; h < hands; h++) {
    engine.startHand();
    let guard = 0;
    while (engine.street !== "complete" && guard++ < 40) {
      const legal = engine.legal(engine.toAct);
      assert(legal.length > 0, "합법 액션");
      engine.apply(engine.toAct, legal[(rng() * legal.length) | 0]);
      assert(engine.chipSum() === expected, `핸드 ${h} 액션 ${guard} 칩 합 ${engine.chipSum()}`);
    }
    assert(engine.street === "complete", `랜덤 핸드 종료 ${h}`);
    assert(engine.chipSum() === expected, `핸드 종료 칩 ${engine.chipSum()}`);
  }
  assert(engine.profit[0] + engine.profit[1] === 0, "랜덤 수익 합");
}

randomHands(11, 250, 2000);
randomHands(19, 120, 80);

{
  const quiet = cloneParams(BASE_PARAMS);
  quiet.noise = 0;
  const a = oneHand(quiet, quiet, 42, 0, 5);
  const b = oneHand(quiet, quiet, 42, 0, 5);
  assert(a === b, `결정성 ${a} ${b}`);
}

{
  const engine = new PokerEngine({ seed: 21, startStack: 2000, sb: 10, bb: 20 });
  const agents = [{ params: cloneParams(BASE_PARAMS) }, { params: cloneParams(TIGHT_PARAMS) }];
  const kinds = new Set();
  for (let i = 0; i < 40; i++) {
    const trace = playHand(engine, agents, engine.rng, 6);
    for (const step of trace) kinds.add(step.action.type);
    assert(engine.chipSum() === 4000, "미니맥스 칩 보존");
  }
  assert(kinds.has("fold") || kinds.has("call") || kinds.has("check"), `액션 다양성 ${[...kinds]}`);
  assert(kinds.size >= 2, `서로 다른 액션 ${[...kinds]}`);
  assert(engine.profit[0] + engine.profit[1] === 0, "미니맥스 수익 합");
}

{
  const rng = mulberry32(1);
  const view = {
    street: "river",
    pot: 100,
    toCall: 10,
    bb: 20,
    minRaise: 20,
    heroStack: 800,
    oppStack: 800,
    opponentActsAfterCheck: false,
    equity: 0.93,
    legal: [
      { type: "fold", put: 0 },
      { type: "call", put: 10, total: 30 },
      { type: "raise", put: 70, total: 90 },
    ],
  };
  const quiet = cloneParams(BASE_PARAMS);
  quiet.noise = 0;
  const action = decideMinimax(view, quiet, rng);
  assert(action.type !== "fold", `강한 패가 폴드함 ${action.type}`);
}

{
  const rng = mulberry32(2);
  const view = {
    street: "river",
    pot: 200,
    toCall: 100,
    bb: 20,
    minRaise: 20,
    heroStack: 500,
    oppStack: 500,
    opponentActsAfterCheck: false,
    equity: 0.08,
    legal: [
      { type: "fold", put: 0 },
      { type: "call", put: 100, total: 100 },
      { type: "allin", put: 500, total: 500 },
    ],
  };
  const quiet = cloneParams(BASE_PARAMS);
  quiet.noise = 0;
  const action = decideMinimax(view, quiet, rng);
  assert(action.type === "fold", `에어가 ${action.type}`);
}

{
  const view = {
    street: "river",
    pot: 40,
    toCall: 80,
    bb: 20,
    minRaise: 20,
    heroStack: 400,
    oppStack: 400,
    opponentActsAfterCheck: false,
    equity: 0.7,
    legal: [
      { type: "fold", put: 0 },
      { type: "call", put: 80, total: 80 },
    ],
  };
  const loose = cloneParams(BASE_PARAMS);
  loose.noise = 0;
  loose.tightRiver = -0.12;
  const tight = cloneParams(BASE_PARAMS);
  tight.noise = 0;
  tight.tightRiver = 0.12;
  const calls = decideMinimax(view, loose, mulberry32(3));
  const folds = decideMinimax(view, tight, mulberry32(3));
  assert(calls.type === "call" && folds.type === "fold", `river offset ${calls.type} ${folds.type}`);
}

{
  const view = {
    street: "river",
    pot: 100,
    toCall: 0,
    bb: 20,
    minRaise: 20,
    heroStack: 400,
    oppStack: 400,
    opponentActsAfterCheck: false,
    equity: 0.64,
    legal: [
      { type: "check", put: 0 },
      { type: "bet", put: 60, total: 60 },
      { type: "bet", put: 80, total: 80 },
    ],
  };
  const plain = cloneParams(BASE_PARAMS);
  plain.noise = 0;
  plain.tightness = 0;
  const smaller = cloneParams(plain);
  smaller.sizeValue = -0.45;
  const bluffOnly = cloneParams(plain);
  bluffOnly.sizeBluff = -0.45;
  const one = decideMinimax(view, plain, mulberry32(4));
  const value = decideMinimax(view, smaller, mulberry32(4));
  const bluff = decideMinimax(view, bluffOnly, mulberry32(4));
  assert(one.put === 80 && value.put === 60 && bluff.put === 80, `bet sizes ${one.put} ${value.put} ${bluff.put}`);
}

const root = fileURLToPath(new URL("..", import.meta.url));
assert(resolveStatic(root, "/js/main.js")?.endsWith("main.js"), "serves main.js");
assert(resolveStatic(root, "/../serve.mjs") === null, "blocks parent path");
assert(resolveStatic(root, "/js/%2e%2e/%2e%2e/serve.mjs") === null, "blocks encoded parent");
assert(resolveStatic(root, "/%") === null, "blocks bad encoding");
assert(resolveStatic(root, "/test/selfcheck.mjs") === null, "blocks non-asset files");

const hostile = normalizePreset({
  name: "A\u202ebaseline\n<script>",
  id: "bad id!",
  params: { tightness: 99, aggression: "nope" },
  stats: { ref: "10", h2h: 1e9 },
  blurb: "ok",
});
assert(hostile && !hostile.name.includes("\n") && !hostile.name.includes("\u202e"), "preset name cleaned");
assert(hostile.params.tightness === 0.28, "tightness clamped");
assert(hostile.params.aggression === 1, "invalid aggression ignored");
assert(hostile.stats?.ref === 10 && hostile.stats.h2h == null, "stats cleaned");
assert(/^[\w-]+$/.test(hostile.id), "preset id charset");

const zeros = [0, 0, 0, 0, 0, 0, 0, 0];
assert(leadsByNoise(zeros.map(() => 20), zeros), "steady lead replaces the parent");
assert(!leadsByNoise([400, -10, -10, -10, -10, -10, -10, -10], zeros), "one lucky deal keeps the parent");
assert(!leadsByNoise(zeros, zeros), "a tie keeps the parent");
const mildLead = [3, 3, 3, 3, -1, -1, -1, -1];
assert(leadsByNoise(mildLead, zeros), "a small lead clears one standard error");
assert(!leadsByNoise(mildLead, zeros, 2), "a small lead stays inside two standard errors");
const paired = duplicateMatch(BASE_PARAMS, TIGHT_PARAMS, 2, 1, mulberry32(1));
assert(paired.perSeed.length === 2, "match keeps one result per deal");
assert(Math.abs(paired.perSeed.reduce((sum, n) => sum + n, 0) - paired.profit) < 1e-6, "deal results sum to profit");

const trained = await trainCompetition({
  paramsA: BASE_PARAMS,
  paramsB: TIGHT_PARAMS,
  generations: 1,
  population: 2,
  pairs: 8,
  samples: 1,
  rng: mulberry32(2),
});
assert(trained.history.length >= 1 && trained.history[0].gen === 0, "training keeps the opening generation");
assert(trained.paramsA.tightness <= 0.28 && trained.paramsA.tightness >= -0.22, "trained tightness stays in range");

let rankThrew = false;
try {
  rankPresets([{ params: BASE_PARAMS }]);
} catch {
  rankThrew = true;
}
assert(rankThrew, "ranking requires a shared deal pack");

const emptyRank = rankPresets([], { seeds: [1], samples: 1 });
assert(emptyRank.champion === null && emptyRank.rows.length === 0, "empty field has no champion");

const only = { id: "only", name: "Only", params: cloneParams(BASE_PARAMS) };
const solo = rankPresets([only], { seeds: [1], samples: 1 });
solo.champion.params.tightness = 0.2;
assert(solo.champion.id === "only" && solo.champion.mean === 0, "one preset is the champion");
assert(only.params.tightness === BASE_PARAMS.tightness, "champion params are a copy");

const twins = rankPresets(
  [
    { id: "first", name: "First", params: BASE_PARAMS },
    { id: "second", name: "Second", params: BASE_PARAMS },
  ],
  { seeds: [1, 2, 3, 4], samples: 1 },
);
assert(twins.champion.id === "first", "equal presets keep the earlier one");
assert(twins.rows.every((row) => row.mean === 0), "equal presets score zero");

const field = [
  { id: "minimax-base", name: "Baseline", algorithm: "minimax", params: BASE_PARAMS },
  { id: "minimax-tight", name: "Tight", algorithm: "minimax", params: TIGHT_PARAMS },
];
const ranked = rankPresets(field, { samples: 1, seeds: [11, 12, 13, 14] });
const replay = rankPresets(field, { samples: 1, seeds: [11, 12, 13, 14] });
assert(ranked.rows.length === 2 && ranked.seeds.length === 4, "ranking keeps both presets and the deal pack");
assert(Math.abs(ranked.rows[0].mean + ranked.rows[1].mean) < 1e-6, "ranking is zero-sum");
assert(replay.champion.id === ranked.champion.id && replay.champion.mean === ranked.champion.mean, "same deals, same rank");
assert(ranked.champion.params.tightness === field.find((preset) => preset.id === ranked.champion.id).params.tightness, "champion keeps its parameters");

const rangeOnly = rankPresets(
  [{ id: "range-base", name: "Range", algorithm: "range", params: BASE_PARAMS }],
  { seeds: [1], samples: 1 },
);
assert(rangeOnly.champion.algorithm === "range", "champion keeps its algorithm");

const ladderChampion = {
  id: "minimax-base",
  name: "Baseline",
  algorithm: "minimax",
  params: cloneParams(BASE_PARAMS),
};
let ladderMeasured = false;
const skippedLadder = await trainLadder({
  champion: ladderChampion,
  deadline: 5,
  now: () => 5,
  measure: () => {
    ladderMeasured = true;
    return { deals: [0, 0, 0, 0], fitness: 0 };
  },
});
assert(!ladderMeasured && skippedLadder.promotions === 0, "a passed deadline does not play");
assert(skippedLadder.champion.params.tightness === BASE_PARAMS.tightness, "a passed deadline keeps the champion");
assert(ladderChampion.params.tightness === BASE_PARAMS.tightness, "ladder leaves the input preset alone");

function scriptedMeasure(mode) {
  let calls = 0;
  return (candidate, champion, h2hSeeds) => {
    const call = calls++;
    const lead = mode === "promote" ? call % 4 === 1 || call % 4 === 3 : call % 4 === 1;
    const deals = h2hSeeds.map(() => (lead ? 20 : 0));
    return { deals, h2h: lead ? 20 : 0, ref: 0, fitness: lead ? 20 : 0 };
  };
}
function stopAfterStep() {
  let time = 0;
  return {
    now: () => time,
    deadline: 10,
    onProgress: (info) => {
      if (info.phase === "Promoted" || info.phase === "Held") time = 10;
    },
  };
}
const clock = stopAfterStep();
const promoted = await trainLadder({
  champion: ladderChampion,
  ...clock,
  population: 2,
  pairs: 8,
  samples: 1,
  algorithmFlip: 0,
  rng: mulberry32(5),
  measure: scriptedMeasure("promote"),
});
assert(promoted.promotions === 1 && promoted.history.length === 1, "a confirmed lead promotes once");
assert(promoted.champion.generation === 1 && promoted.scale === 1, "a promotion keeps the mutation width");
assert(promoted.champion.algorithm === "minimax", "flip rate zero keeps the algorithm");
assert(promoted.quietSteps === 0, "a promotion clears the stall");
assert(JSON.stringify(promoted.champion.params) !== JSON.stringify(ladderChampion.params), "a promotion changes parameters");

const holdClock = stopAfterStep();
const held = await trainLadder({
  champion: ladderChampion,
  ...holdClock,
  population: 2,
  pairs: 8,
  samples: 1,
  algorithmFlip: 0,
  rng: mulberry32(6),
  measure: scriptedMeasure("reject"),
});
assert(held.promotions === 0 && held.history[0].promoted === false, "a failed confirmation keeps the champion");
assert(held.quietSteps === 1, "a held step counts toward the stall");
assert(held.scale < 1 && held.champion.generation === 0, "a failed confirmation shrinks the mutation");
assert(JSON.stringify(held.champion.params) === JSON.stringify(ladderChampion.params), "a failed confirmation keeps the parameters");

const smoked = await trainLadder({
  champion: ladderChampion,
  deadline: Date.now() + 60_000,
  population: 2,
  pairs: 4,
  samples: 1,
  algorithmFlip: 0,
  maxSteps: 1,
  rng: mulberry32(4),
});
let yields = 0;
const yielded = await trainLadder({
  champion: ladderChampion,
  deadline: 1_000_000,
  now: () => 0,
  population: 2,
  pairs: 8,
  samples: 1,
  algorithmFlip: 0,
  maxSteps: 1,
  rng: mulberry32(8),
  measure: scriptedMeasure("reject"),
  yield: async () => {
    yields += 1;
  },
});
assert(yields >= 1 && yielded.history.length === 1, "ladder can yield without timers");

const streetSeen = [];
await trainLadder({
  champion: ladderChampion,
  deadline: 1_000_000,
  now: () => 0,
  population: 2,
  pairs: 8,
  samples: 1,
  algorithmFlip: 0,
  scale: 0.35,
  widenAfter: 0,
  maxSteps: 1,
  rng: mulberry32(9),
  measure: (candidate, _champion, seeds) => {
    streetSeen.push(candidate.params);
    return { deals: seeds.map(() => 0), fitness: 0 };
  },
});
assert(streetSeen.length >= 2 && streetSeen[0].tightRiver === 0, "the parent keeps zero street offsets");
assert(
  ["tightPre", "tightFlop", "tightTurn", "tightRiver"].some((key) => streetSeen[1][key] !== 0),
  "a stalled ladder mutates street tightness",
);
assert(streetSeen[1].openPre === 0 && streetSeen[1].openPost === 0, "street widening leaves the continue range alone");
assert(streetSeen[1].sizeValue === 0 && streetSeen[1].sizeBluff === 0, "street widening leaves bet sizes alone");
const rangeSeen = [];
await trainLadder({
  champion: ladderChampion,
  deadline: 1_000_000,
  now: () => 0,
  population: 2,
  pairs: 8,
  samples: 1,
  algorithmFlip: 0,
  scale: 0.35,
  widenAfter: 99,
  rangeAfter: 0,
  maxSteps: 1,
  rng: mulberry32(11),
  measure: (candidate, _champion, seeds) => {
    rangeSeen.push(candidate.params);
    return { deals: seeds.map(() => 0), fitness: 0 };
  },
});
assert(rangeSeen[0].openPre === 0 && rangeSeen[0].openPost === 0, "the parent keeps a closed continue range");
assert(rangeSeen[1].tightRiver === 0, "continue-range widening leaves street tightness alone");
assert(rangeSeen[1].openPre !== 0 || rangeSeen[1].openPost !== 0, "a longer stall mutates the continue range");
assert(rangeSeen[1].sizeValue === 0 && rangeSeen[1].sizeBluff === 0, "continue-range widening leaves bet sizes alone");
const betSeen = [];
await trainLadder({
  champion: ladderChampion,
  deadline: 1_000_000,
  now: () => 0,
  population: 2,
  pairs: 8,
  samples: 1,
  algorithmFlip: 0,
  scale: 0.35,
  widenAfter: 99,
  rangeAfter: 99,
  betAfter: 0,
  maxSteps: 1,
  rng: mulberry32(13),
  measure: (candidate, _champion, seeds) => {
    betSeen.push(candidate.params);
    return { deals: seeds.map(() => 0), fitness: 0 };
  },
});
assert(betSeen[0].sizeValue === 0 && betSeen[0].sizeBluff === 0, "the parent keeps one bet size");
assert(betSeen[1].tightRiver === 0 && betSeen[1].openPre === 0, "bet-size widening leaves the earlier genes alone");
assert(betSeen[1].sizeValue !== 0 || betSeen[1].sizeBluff !== 0, "the longest stall mutates the two bet sizes");
const resumed = [];
const resumedRun = await trainLadder({
  champion: ladderChampion,
  deadline: 1_000_000,
  now: () => 0,
  population: 2,
  pairs: 8,
  samples: 1,
  algorithmFlip: 0,
  scale: 0.35,
  quietSteps: 6,
  maxSteps: 1,
  rng: mulberry32(9),
  measure: (candidate, _champion, seeds) => {
    resumed.push(candidate.params);
    return { deals: seeds.map(() => 0), fitness: 0 };
  },
});
assert(
  ["tightPre", "tightFlop", "tightTurn", "tightRiver"].some((key) => resumed[1][key] !== 0),
  "a resumed stall keeps the street genes open",
);
assert(resumed[1].openPre === 0 && resumed[1].sizeValue === 0, "a six-step stall leaves the later genes closed");
assert(resumedRun.quietSteps === 7, "a resumed hold keeps counting");
const clamped = cloneParams({ tightRiver: 9, openPre: 9, sizeValue: 9 });
assert(clamped.tightRiver === 0.12, "street tightness is clamped");
assert(clamped.openPre === 3, "continue range is clamped");
assert(clamped.sizeValue === 0.45, "bet size offset is clamped");
assert(formatPace(0, 120_000) === "", "pace waits for a finished step");
assert(formatPace(3, 30_000) === "", "pace waits through the first minute");
assert(formatPace(2, 1_800_000) === "4.0 steps/h", "pace is steps per hour");
assert(formatPace(120, 3_600_000) === "120 steps/h", "a fast pace rounds to a whole number");
assert(geneTier(1, 20) === "" && geneTier(0.35, 5) === "", "extra genes stay shut while the search is still moving");
assert(geneTier(0.35, 6) === "Street tightness", "six quiet steps open street tightness");
assert(geneTier(0.35, 12) === "Continue range" && geneTier(0.35, 18) === "Bet sizes", "later stalls open the next genes");
assert(smoked.history.length === 1, "one ladder step records a result");
assert(smoked.champion.params.tightness <= 0.28 && smoked.champion.params.tightness >= -0.22, "ladder params stay in range");

const stream = mulberry32(7);
stream();
const mark = stream.getState();
const upcoming = stream();
assert(mulberry32(mark)() === upcoming, "rng resumes from its saved state");

let hall = [];
for (let i = 0; i < 10; i++) hall = rememberChampion(hall, { name: `C${i}`, params: BASE_PARAMS, generation: i });
assert(hall.length === 8 && hall[0].generation === 2 && hall[7].generation === 9, "hall keeps the newest eight");

const expired = normalizeLadder(
  {
    hall: [{ name: "A\nbad", algorithm: "range", params: BASE_PARAMS, generation: 2 }],
    run: { champion: { name: "A", params: BASE_PARAMS }, deadline: 1, scale: 9 },
  },
  10,
);
assert(expired.run === null && expired.hall[0].name === "Abad" && expired.hall[0].algorithm === "range", "expired runs drop and names are cleaned");
const live = normalizeLadder(
  {
    hall: [],
    run: {
      champion: { name: "Tight", algorithm: "nope", params: { tightness: 99 }, generation: 4 },
      deadline: 50,
      scale: 0.1,
      promotions: 4,
      rngState: 12,
      population: 9,
      pairs: 3,
      samples: 99,
      hours: 0,
      quietSteps: 7,
    },
  },
  20,
);
assert(live.run.deadline === 50 && live.run.scale === 0.35, "a live run keeps its deadline and clamps scale");
assert(live.run.champion.params.tightness === 0.28 && live.run.champion.algorithm === "minimax", "a saved champion is clamped");
assert(live.run.population === 5 && live.run.pairs === 8 && live.run.samples === 8 && live.run.hours === 1, "saved ladder settings are clamped");
assert(live.run.rngState === 12, "saved rng state is kept");
assert(live.run.quietSteps === 7, "a saved stall is kept");
assert(
  normalizeLadder({ run: { champion: { name: "A", params: BASE_PARAMS }, deadline: 50, quietSteps: 10000 } }, 20).run.quietSteps === 0,
  "a huge stall is dropped",
);

assert(handContinues(12, 12 + 13, []), "pocket aces continue preflop");
assert(handContinues(12, 11, []), "suited ace-king continues preflop");
assert(!handContinues(5, 13, []), "offsuit seven-two folds preflop");
assert(handContinues(12, 12 + 13, [0, 5 + 13, 7 + 26]), "aces continue on a dry board");
assert(!handContinues(1 + 39, 2 + 26, [0, 5 + 13, 7 + 13]), "unrelated low cards fold on a dry board");
assert(handContinues(7, 6, []), "suited nine-eight continues preflop");
assert(!handContinues(7, 6, [], { openPre: 3 }), "a tighter preflop range folds suited nine-eight");
assert(handContinues(10, 22, [0, 17, 32]), "queen-jack continues as two overcards");
assert(!handContinues(10, 22, [0, 17, 32], { openPost: 1 }), "a tighter overcard line folds queen-jack");

if (failed) {
  console.error(`${failed}개 실패`);
  process.exit(1);
}
console.log("selfcheck ok");
