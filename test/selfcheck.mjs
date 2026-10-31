import { handTitle, scoreCards } from "../js/eval.js";
import { PokerEngine } from "../js/engine.js";
import { decideMinimax } from "../js/agent.js";
import { oneHand, playHand } from "../js/play.js";
import { BASE_PARAMS, TIGHT_PARAMS, cloneParams } from "../js/params.js";
import { mulberry32 } from "../js/rng.js";

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

if (failed) {
  console.error(`${failed}개 실패`);
  process.exit(1);
}
console.log("selfcheck ok");
