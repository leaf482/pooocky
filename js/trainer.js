import { decideMinimax } from "./agent.js";
import { duplicateMatch } from "./play.js";
import { BASE_PARAMS, cloneParams, mixParams, mutateParams, sanitizeParams } from "./params.js";
import { gaussian } from "./rng.js";

function yieldNow() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function candidatesOf(self, rival, population, rng, scale) {
  const list = [cloneParams(self)];
  for (let i = 1; i < population; i++) {
    const explore = i % 2 === 0;
    const base = explore ? mixParams(self, rival, 0.35) : self;
    list.push(mutateParams(base, rng, gaussian, scale * (explore ? 0.55 : 0.85)));
  }
  return list;
}

function makeSeeds(count, rng) {
  return Array.from({ length: count }, () => (rng() * 0x100000000) >>> 0);
}

function seedBb(chips, bb = 20) {
  return (chips / bb / 2) * 100;
}

function measure(params, rival, h2hSeeds, refSeeds, samples, algorithm = "minimax", rivalAlgorithm = "minimax") {
  const h2h = duplicateMatch(params, rival, h2hSeeds.length, samples, null, 20, h2hSeeds, algorithm, rivalAlgorithm);
  const ref = duplicateMatch(params, BASE_PARAMS, refSeeds.length, samples, null, 20, refSeeds, algorithm, "minimax");
  const n = Math.min(h2h.perSeed.length, ref.perSeed.length);
  const deals = [];
  for (let i = 0; i < n; i++) deals.push(0.55 * seedBb(h2h.perSeed[i]) + 0.45 * seedBb(ref.perSeed[i]));
  return {
    h2h: h2h.bbPer100,
    ref: ref.bbPer100,
    fitness: 0.55 * h2h.bbPer100 + 0.45 * ref.bbPer100,
    deals,
  };
}

/** Child must beat the parent by more than the paired sample's own noise. */
export function leadsByNoise(childDeals, parentDeals) {
  if (!childDeals || !parentDeals) return false;
  const n = Math.min(childDeals.length, parentDeals.length);
  if (n < 4) return false;
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < n; i++) {
    const d = childDeals[i] - parentDeals[i];
    sum += d;
    sum2 += d * d;
  }
  const mean = sum / n;
  const variance = Math.max(0, sum2 / (n - 1) - (mean * mean * n) / (n - 1));
  const se = Math.sqrt(variance / n);
  return mean > se;
}

function publish(score) {
  if (!score) return null;
  return { h2h: score.h2h, ref: score.ref, fitness: score.fitness };
}

function clampScale(value) {
  return Math.max(0.35, Math.min(1.5, value));
}

/**
 * Both seats evolve by replaying the same deals. A child replaces its parent
 * only when the paired lead beats the sample noise, then again on a fresh
 * set of deals. The mutation step shrinks while the parent holds.
 */
export async function trainCompetition(options) {
  const generations = options.generations;
  const population = options.population;
  const pairs = options.pairs;
  const samples = options.samples;
  const rng = options.rng;
  const algorithmA = options.algorithmA === "range" ? "range" : "minimax";
  const algorithmB = options.algorithmB === "range" ? "range" : "minimax";
  const onProgress = options.onProgress || (() => {});
  const shouldStop = options.shouldStop || (() => false);

  let a = sanitizeParams(options.paramsA);
  let b = sanitizeParams(options.paramsB);
  let scaleA = 1;
  let scaleB = 1;
  const history = [];

  function report(gen, phase, scoreA, scoreB) {
    onProgress({
      gen,
      total: generations,
      phase,
      a: publish(scoreA),
      b: publish(scoreB),
      history,
    });
  }

  async function confirmPick(label, gen, best, parent, rival, count, otherScore, algorithm, rivalAlgorithm) {
    if (!best?.score || !parent?.score) {
      return { params: parent?.params || best?.params, score: best?.score || null, scaleMul: 1 };
    }
    if (best.index === 0 || shouldStop()) {
      return { params: best.params, score: best.score, scaleMul: best.index === 0 ? 0.85 : 1 };
    }
    report(gen, `Confirming ${label}`, best.score, otherScore());
    await yieldNow();
    if (shouldStop()) return { params: best.params, score: best.score, scaleMul: 1 };
    const freshH2h = makeSeeds(count, rng);
    const freshRef = makeSeeds(count, rng);
    const againParent = measure(parent.params, rival, freshH2h, freshRef, samples, algorithm, rivalAlgorithm);
    const againChild = measure(best.params, rival, freshH2h, freshRef, samples, algorithm, rivalAlgorithm);
    if (leadsByNoise(againChild.deals, againParent.deals)) {
      return { params: best.params, score: best.score, scaleMul: 1.15 };
    }
    return { params: parent.params, score: parent.score, scaleMul: 0.85 };
  }

  for (let gen = 0; gen <= generations; gen++) {
    if (shouldStop()) break;
    const h2hSeeds = makeSeeds(pairs, rng);
    const refSeeds = makeSeeds(pairs, rng);

    if (gen === 0) {
      const scoreA = measure(a, b, h2hSeeds, refSeeds, samples, algorithmA, algorithmB);
      await yieldNow();
      if (shouldStop()) break;
      const scoreB = measure(b, a, h2hSeeds, refSeeds, samples, algorithmB, algorithmA);
      history.push({
        gen,
        a: publish(scoreA),
        b: publish(scoreB),
        paramsA: cloneParams(a),
        paramsB: cloneParams(b),
      });
      report(gen, "Opening strength", scoreA, scoreB);
      await yieldNow();
      continue;
    }

    const frozenA = cloneParams(a);
    const frozenB = cloneParams(b);
    const candA = candidatesOf(frozenA, frozenB, population, rng, scaleA);
    const candB = candidatesOf(frozenB, frozenA, population, rng, scaleB);

    let shownA = null;
    let shownB = null;
    let parentA = null;
    let bestA = null;
    for (let i = 0; i < candA.length; i++) {
      if (shouldStop()) break;
      const score = measure(candA[i], frozenB, h2hSeeds, refSeeds, samples, algorithmA, algorithmB);
      if (i === 0) {
        parentA = { params: candA[0], score, fitness: score.fitness, index: 0 };
        bestA = parentA;
      } else if (parentA && leadsByNoise(score.deals, parentA.score.deals) && score.fitness > bestA.fitness) {
        bestA = { params: candA[i], score, fitness: score.fitness, index: i };
      }
      shownA = bestA?.score || null;
      report(gen, `A candidate ${i + 1}/${candA.length}`, shownA, shownB);
      await yieldNow();
    }

    let parentB = null;
    let bestB = null;
    for (let i = 0; i < candB.length; i++) {
      if (shouldStop()) break;
      const score = measure(candB[i], frozenA, h2hSeeds, refSeeds, samples, algorithmB, algorithmA);
      if (i === 0) {
        parentB = { params: candB[0], score, fitness: score.fitness, index: 0 };
        bestB = parentB;
      } else if (parentB && leadsByNoise(score.deals, parentB.score.deals) && score.fitness > bestB.fitness) {
        bestB = { params: candB[i], score, fitness: score.fitness, index: i };
      }
      shownB = bestB?.score || null;
      report(gen, `B candidate ${i + 1}/${candB.length}`, shownA, shownB);
      await yieldNow();
    }

    if (shouldStop() && (!bestA?.score || !bestB?.score)) break;

    const confirmCount = Math.max(8, Math.min(pairs, Math.round(pairs * 0.5)));
    const decidedA = await confirmPick("A", gen, bestA, parentA, frozenB, confirmCount, () => shownB, algorithmA, algorithmB);
    const decidedB = await confirmPick("B", gen, bestB, parentB, frozenA, confirmCount, () => decidedA.score, algorithmB, algorithmA);
    scaleA = clampScale(scaleA * decidedA.scaleMul);
    scaleB = clampScale(scaleB * decidedB.scaleMul);
    a = decidedA.params;
    b = decidedB.params;
    shownA = decidedA.score;
    shownB = decidedB.score;
    history.push({
      gen,
      a: publish(shownA),
      b: publish(shownB),
      paramsA: cloneParams(a),
      paramsB: cloneParams(b),
    });
    report(gen, `Generation ${gen} locked`, shownA, shownB);
  }

  return { paramsA: cloneParams(a), paramsB: cloneParams(b), history };
}

export { decideMinimax };
