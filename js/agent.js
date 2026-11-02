import { clamp } from "./params.js";

const REALIZE = {
  preflop: 0.6,
  flop: 0.78,
  turn: 0.9,
  river: 1,
};

function foldChance(size, pot, params) {
  const spr = size / Math.max(pot, 1);
  const base = 0.05 + Math.min(spr, 2.2) * 0.16 + Math.max(0, spr - 2.2) * 0.07;
  return clamp(base * params.foldEquity, 0.03, 0.88);
}

function calledEquity(equity, size, pot) {
  const spr = size / Math.max(pot, 1);
  const drop = 0.07 * Math.min(spr, 1.4) + 0.045 * Math.max(0, spr - 1.4);
  return clamp(equity - drop, 0.05, 0.96);
}

function callEquity(equity, cost, pot) {
  const spr = cost / Math.max(pot, 1);
  const drop = 0.04 * Math.min(spr, 1.5);
  return clamp(equity - drop, 0.05, 0.97);
}

function scoreAction(action, view, equity, params) {
  const pot = view.pot;
  if (action.type === "fold") return 0;

  if (action.type === "check") {
    if (!view.opponentActsAfterCheck) return equity * pot;
    const bet = Math.min(
      view.oppStack,
      Math.max(view.bb, Math.floor(pot * 0.66) || view.bb),
    );
    if (bet <= 0) return equity * pot;
    const faced = callEquity(equity, bet, pot);
    const continueEv = Math.max(0, faced * (pot + 2 * bet) - bet);
    return 0.62 * equity * pot + 0.38 * continueEv;
  }

  if (action.type === "call") {
    const cost = action.put;
    return callEquity(equity, cost, pot) * (pot + cost) - cost;
  }

  const toCall = view.toCall;
  const extra = Math.max(0, action.put - toCall);
  if (extra <= 0) {
    const cost = action.put;
    return callEquity(equity, cost, pot) * (pot + cost) - cost;
  }

  const effExtra = Math.min(extra, view.oppStack);
  if (effExtra <= 0) return callEquity(equity, toCall, pot) * (pot + toCall) - toCall;

  const fold = foldChance(effExtra, pot + toCall, params);
  let raise = effExtra > (pot + toCall) * 1.4 ? 0.03 : 0.07;
  if (fold + raise > 0.9) raise = Math.max(0.02, 0.9 - fold);
  const call = 1 - fold - raise;
  const faced = calledEquity(equity, effExtra, pot + toCall);
  const called = faced * (pot + toCall + 2 * effExtra) - (toCall + effExtra);
  let raised = called;
  const minR = Math.max(view.bb, view.minRaise || view.bb);
  if (view.oppStack > effExtra && view.heroStack > toCall + effExtra) {
    let r = Math.max(minR, Math.floor((pot + toCall + 2 * effExtra) * 0.55));
    r = Math.min(r, view.oppStack - effExtra, view.heroStack - (toCall + effExtra));
    if (r > 0) {
      const deep = calledEquity(equity, effExtra + r, pot + toCall);
      const callRaise = deep * (pot + toCall + 2 * (effExtra + r)) - (toCall + effExtra + r);
      raised = Math.max(-(toCall + effExtra), callRaise);
    }
  }

  let ev = fold * pot + call * called + raise * raised;
  ev -= effExtra * 0.04;
  if (toCall > 0) ev -= pot * 0.055;
  ev += (params.aggression - 1) * pot * 0.1;
  if (equity < 0.34) ev += params.bluff * pot * 1.05;
  return ev;
}

function sizeDistance(action, target, pot) {
  if (action.type === "fold") return 8;
  if (action.type === "check" || action.type === "call") return 0.62;
  return Math.abs(action.put / Math.max(pot, 1) - target);
}

/**
 * Two-ply expectiminimax on the betting tree.
 * Equity is a chance node (Monte Carlo). Hero maximizes.
 * The opponent answers with a fold / call / reraise mixture, and hero
 * then takes the better of calling or folding to a reraise.
 */
export function decideMinimax(view, params, rng) {
  const legal = view.legal || [];
  if (!legal.length) return { type: "check", put: 0 };
  if (legal.length === 1) return legal[0];

  const realize = REALIZE[view.street] ?? 1;
  const streetKey = { preflop: "tightPre", flop: "tightFlop", turn: "tightTurn", river: "tightRiver" }[view.street];
  const streetTight = streetKey ? Number(params[streetKey]) || 0 : 0;
  const equity = clamp(0.5 + (view.equity - 0.5) * realize - params.tightness - streetTight, 0.04, 0.98);

  if (rng() < (params.noise || 0)) {
    return legal[(rng() * legal.length) | 0];
  }

  let bestEv = -Infinity;
  const scored = legal.map((action) => {
    const ev = scoreAction(action, view, equity, params);
    if (ev > bestEv) bestEv = ev;
    return { action, ev };
  });

  const band = Math.max(0.6, view.pot * 0.012);
  const pool = scored.filter((item) => item.ev >= bestEv - band);
  const target = 0.4 + params.betMix * 0.85;
  pool.sort(
    (a, b) =>
      sizeDistance(a.action, target, view.pot) - sizeDistance(b.action, target, view.pot) ||
      b.ev - a.ev,
  );
  return pool[0].action;
}

export { scoreAction };
