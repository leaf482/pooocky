import { decideMinimax } from "./agent.js";
import { duplicateMatch } from "./play.js";
import { BASE_PARAMS, cloneParams, mixParams, mutateParams, sanitizeParams } from "./params.js";
import { gaussian } from "./rng.js";

function yieldNow() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function candidatesOf(self, rival, population, rng) {
  const list = [cloneParams(self)];
  for (let i = 1; i < population; i++) {
    const towardRival = i % 2 === 0;
    const base = towardRival ? mixParams(self, rival, 0.42) : self;
    list.push(mutateParams(base, rng, gaussian, towardRival ? 0.75 : 1));
  }
  return list;
}

function makeSeeds(count, rng) {
  return Array.from({ length: count }, () => (rng() * 0x100000000) >>> 0);
}

function measure(params, rival, h2hSeeds, refSeeds, samples) {
  const h2h = duplicateMatch(params, rival, h2hSeeds.length, samples, null, 20, h2hSeeds);
  const ref = duplicateMatch(params, BASE_PARAMS, refSeeds.length, samples, null, 20, refSeeds);
  return {
    h2h: h2h.bbPer100,
    ref: ref.bbPer100,
    fitness: 0.55 * h2h.bbPer100 + 0.45 * ref.bbPer100,
  };
}

/**
 * Both seats evolve by playing duplicate hands against each other and
 * against the frozen base minimax. Each generation keeps the parameter
 * vector with the higher fitness, so a seat only changes when a child
 * outscores its parent on that generation's sample.
 */
export async function trainCompetition(options) {
  const generations = options.generations;
  const population = options.population;
  const pairs = options.pairs;
  const samples = options.samples;
  const rng = options.rng;
  const onProgress = options.onProgress || (() => {});
  const shouldStop = options.shouldStop || (() => false);

  let a = sanitizeParams(options.paramsA);
  let b = sanitizeParams(options.paramsB);
  const history = [];

  for (let gen = 0; gen <= generations; gen++) {
    if (shouldStop()) break;
    const h2hSeeds = makeSeeds(pairs, rng);
    const refSeeds = makeSeeds(pairs, rng);

    if (gen === 0) {
      const scoreA = measure(a, b, h2hSeeds, refSeeds, samples);
      await yieldNow();
      if (shouldStop()) break;
      const scoreB = measure(b, a, h2hSeeds, refSeeds, samples);
      history.push({ gen, a: scoreA, b: scoreB, paramsA: cloneParams(a), paramsB: cloneParams(b) });
      onProgress({
        gen,
        total: generations,
        phase: "Opening strength",
        a: scoreA,
        b: scoreB,
        history,
      });
      await yieldNow();
      continue;
    }

    const frozenA = cloneParams(a);
    const frozenB = cloneParams(b);
    const candA = candidatesOf(frozenA, frozenB, population, rng);
    const candB = candidatesOf(frozenB, frozenA, population, rng);

    let bestA = { params: frozenA, score: null, fitness: -Infinity };
    let bestB = { params: frozenB, score: null, fitness: -Infinity };

    for (let i = 0; i < candA.length; i++) {
      if (shouldStop()) break;
      const score = measure(candA[i], frozenB, h2hSeeds, refSeeds, samples);
      if (score.fitness > bestA.fitness) bestA = { params: candA[i], score, fitness: score.fitness };
      onProgress({
        gen,
        total: generations,
        phase: `A candidate ${i + 1}/${candA.length}`,
        a: bestA.score,
        b: bestB.score,
        history,
      });
      await yieldNow();
    }

    for (let i = 0; i < candB.length; i++) {
      if (shouldStop()) break;
      const score = measure(candB[i], frozenA, h2hSeeds, refSeeds, samples);
      if (score.fitness > bestB.fitness) bestB = { params: candB[i], score, fitness: score.fitness };
      onProgress({
        gen,
        total: generations,
        phase: `B candidate ${i + 1}/${candB.length}`,
        a: bestA.score,
        b: bestB.score,
        history,
      });
      await yieldNow();
    }

    if (shouldStop() && (!bestA.score || !bestB.score)) break;
    a = bestA.params;
    b = bestB.params;
    history.push({
      gen,
      a: bestA.score,
      b: bestB.score,
      paramsA: cloneParams(a),
      paramsB: cloneParams(b),
    });
    onProgress({
      gen,
      total: generations,
      phase: `Generation ${gen} locked`,
      a: bestA.score,
      b: bestB.score,
      history,
    });
  }

  return { paramsA: cloneParams(a), paramsB: cloneParams(b), history };
}

export { decideMinimax };
