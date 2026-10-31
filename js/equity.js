import { scoreCards } from "./eval.js";

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
