import { decideMinimax } from "./agent.js";
import { monteCarloEquity } from "./equity.js";
import { PokerEngine } from "./engine.js";
import { rngFrom } from "./rng.js";

export function playHand(engine, agents, rng, samples = 12) {
  engine.startHand();
  const trace = [];
  let guard = 0;
  const random = rng || engine.rng;
  while (engine.street !== "complete" && guard++ < 160) {
    const seat = engine.toAct;
    const view = engine.buildView(seat);
    if (!view) break;
    view.equity = monteCarloEquity(view.hole, view.board, samples, random);
    const params = agents[seat].params;
    const action = decideMinimax(view, params, random);
    trace.push({ ...engine.apply(seat, action), equity: view.equity });
  }
  if (engine.street !== "complete") {
    throw new Error(`핸드가 끝나지 않았습니다 (${engine.street})`);
  }
  return trace;
}

export function oneHand(paramsA, paramsB, seed, button = 0, samples = 8) {
  const rng = rngFrom(seed >>> 0);
  const engine = new PokerEngine({
    rng,
    button,
    startStack: 2000,
    sb: 10,
    bb: 20,
  });
  playHand(engine, [{ params: paramsA }, { params: paramsB }], rng, samples);
  return engine.profit[0];
}

export function duplicateMatch(paramsA, paramsB, pairs, samples, rng, bb = 20, fixedSeeds = null) {
  const seeds = fixedSeeds || Array.from({ length: pairs }, () => (rng() * 0x100000000) >>> 0);
  let profit = 0;
  for (let i = 0; i < seeds.length; i++) {
    const button = i & 1;
    profit += oneHand(paramsA, paramsB, seeds[i], button, samples);
    profit -= oneHand(paramsB, paramsA, seeds[i], button, samples);
  }
  const hands = seeds.length * 2;
  return {
    profit,
    hands,
    bbPer100: (profit / bb / hands) * 100,
  };
}

export function bbPer100(profit, hands, bb = 20) {
  if (!hands) return 0;
  return (profit / bb / hands) * 100;
}
