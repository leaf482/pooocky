import { handCategory, scoreCards } from "./eval.js";

/**
 * Monte Carlo equity of hole cards versus a random opposing hand.
 * Remaining board cards are sampled from the deck that excludes known cards.
 */
export function monteCarloEquity(hole, board, samples, rng) {
  if (!samples || samples < 1) return 0.5;
  const dead = new Uint8Array(52);
  dead[hole[0]] = 1;
  dead[hole[1]] = 1;
  for (let i = 0; i < board.length; i++) dead[board[i]] = 1;

  const remain = [];
  for (let c = 0; c < 52; c++) if (!dead[c]) remain.push(c);
  const need = 2 + (5 - board.length);
  let wins = 0;

  const heroFull = new Array(7);
  const oppFull = new Array(7);
  heroFull[0] = hole[0];
  heroFull[1] = hole[1];
  oppFull[0] = 0;
  oppFull[1] = 0;
  for (let i = 0; i < board.length; i++) {
    heroFull[2 + i] = board[i];
    oppFull[2 + i] = board[i];
  }

  for (let s = 0; s < samples; s++) {
    for (let i = 0; i < need; i++) {
      const j = i + ((rng() * (remain.length - i)) | 0);
      const tmp = remain[i];
      remain[i] = remain[j];
      remain[j] = tmp;
    }
    oppFull[0] = remain[0];
    oppFull[1] = remain[1];
    const boardNeed = 5 - board.length;
    for (let i = 0; i < boardNeed; i++) {
      heroFull[2 + board.length + i] = remain[2 + i];
      oppFull[2 + board.length + i] = remain[2 + i];
    }
    const hs = scoreCards(heroFull);
    const os = scoreCards(oppFull);
    if (hs > os) wins += 1;
    else if (hs === os) wins += 0.5;
  }
  return wins / samples;
}

function hasFlushDraw(cards) {
  const suits = [0, 0, 0, 0];
  for (let i = 0; i < cards.length; i++) suits[(cards[i] / 13) | 0] += 1;
  return suits[0] >= 4 || suits[1] >= 4 || suits[2] >= 4 || suits[3] >= 4;
}

function hasStraightDraw(cards) {
  const seen = new Uint8Array(13);
  for (let i = 0; i < cards.length; i++) seen[cards[i] % 13] = 1;
  let run = 0;
  for (let rank = 0; rank < 13; rank++) {
    run = seen[rank] ? run + 1 : 0;
    if (run >= 4) return true;
  }
  return seen[12] === 1 && seen[0] + seen[1] + seen[2] + seen[3] >= 3;
}

/** Hands that would still be in the pot: pairs and broadways preflop, made hands, draws, or two overcards later. */
export function handContinues(holeA, holeB, board) {
  let high = holeA % 13;
  let low = holeB % 13;
  const suited = ((holeA / 13) | 0) === ((holeB / 13) | 0);
  if (high < low) {
    const swap = high;
    high = low;
    low = swap;
  }
  if (!board.length) {
    if (high === low) return true;
    if (suited && high >= 8) return true;
    if (suited && high - low === 1 && high >= 5) return true;
    if (high === 12 && low >= 8) return true;
    if (high === 12 && suited && low >= 4) return true;
    return high >= 10 && low >= 9;
  }
  const cards = [holeA, holeB, ...board];
  if (board.length >= 3 && handCategory(cards) >= 1) return true;
  if (hasFlushDraw(cards) || hasStraightDraw(cards)) return true;
  let top = 0;
  for (let i = 0; i < board.length; i++) top = Math.max(top, board[i] % 13);
  return high > top && low > top && high >= 10;
}

/**
 * Equity versus hands that still continue, instead of a uniform random hand.
 * Rejected opponent hands are redrawn. If the range is hard to hit, the last
 * samples fall back to whatever hand was drawn.
 */
export function rangeEquity(hole, board, samples, rng) {
  if (!samples || samples < 1) return 0.5;
  const dead = new Uint8Array(52);
  dead[hole[0]] = 1;
  dead[hole[1]] = 1;
  for (let i = 0; i < board.length; i++) dead[board[i]] = 1;

  const remain = [];
  for (let c = 0; c < 52; c++) if (!dead[c]) remain.push(c);
  const need = 2 + (5 - board.length);
  let wins = 0;
  let accepted = 0;
  let tries = 0;
  const cap = samples * 8;

  const heroFull = new Array(7);
  const oppFull = new Array(7);
  heroFull[0] = hole[0];
  heroFull[1] = hole[1];
  for (let i = 0; i < board.length; i++) {
    heroFull[2 + i] = board[i];
    oppFull[2 + i] = board[i];
  }

  while (accepted < samples && tries < cap) {
    tries += 1;
    for (let i = 0; i < need; i++) {
      const j = i + ((rng() * (remain.length - i)) | 0);
      const tmp = remain[i];
      remain[i] = remain[j];
      remain[j] = tmp;
    }
    const mustTake = tries > cap - (samples - accepted);
    if (!mustTake && !handContinues(remain[0], remain[1], board)) continue;
    oppFull[0] = remain[0];
    oppFull[1] = remain[1];
    const boardNeed = 5 - board.length;
    for (let i = 0; i < boardNeed; i++) {
      heroFull[2 + board.length + i] = remain[2 + i];
      oppFull[2 + board.length + i] = remain[2 + i];
    }
    const hs = scoreCards(heroFull);
    const os = scoreCards(oppFull);
    if (hs > os) wins += 1;
    else if (hs === os) wins += 0.5;
    accepted += 1;
  }
  return accepted ? wins / accepted : 0.5;
}

export function estimateEquity(algorithm, hole, board, samples, rng) {
  if (algorithm === "range") return rangeEquity(hole, board, samples, rng);
  return monteCarloEquity(hole, board, samples, rng);
}
