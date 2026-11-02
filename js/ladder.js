import { duplicateMatch } from "./play.js";
import { BASE_PARAMS, cloneParams, mixParams, mutateParams } from "./params.js";
import { gaussian } from "./rng.js";
import { leadsByNoise } from "./trainer.js";

function algorithmOf(preset) {
  return preset?.algorithm === "range" ? "range" : "minimax";
}

function seedBb(chips, bb = 20) {
  return (chips / bb / 2) * 100;
}

function summarize(deals) {
  const n = deals.length;
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < n; i++) {
    sum += deals[i];
    sum2 += deals[i] * deals[i];
  }
  const mean = n ? sum / n : 0;
  const variance = n > 1 ? Math.max(0, (sum2 - (sum * sum) / n) / (n - 1)) : 0;
  return { mean, variance };
}

/**
 * Rank presets on one shared deal pack. The score is paired bb/100 against
 * every other preset. Higher mean wins. A tie goes to the lower variance,
 * then to the earlier preset.
 */
export function rankPresets(presets, options = {}) {
  const list = (Array.isArray(presets) ? presets : []).filter((preset) => preset && preset.params);
  const pairs = options.pairs ?? 24;
  const samples = options.samples ?? 4;
  const seeds =
    options.seeds ||
    (options.rng ? Array.from({ length: pairs }, () => (options.rng() * 0x100000000) >>> 0) : null);
  if (!seeds) throw new Error("rankPresets needs seeds or rng");

  const scores = list.map(() => []);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const match = duplicateMatch(
        list[i].params,
        list[j].params,
        seeds.length,
        samples,
        null,
        20,
        seeds,
        algorithmOf(list[i]),
        algorithmOf(list[j]),
      );
      for (let s = 0; s < match.perSeed.length; s++) {
        const bb = seedBb(match.perSeed[s]);
        scores[i].push(bb);
        scores[j].push(-bb);
      }
    }
  }

  const rows = list.map((preset, index) => {
    const stats = summarize(scores[index]);
    return {
      id: preset.id ?? "",
      name: preset.name ?? "",
      algorithm: algorithmOf(preset),
      mean: stats.mean,
      variance: stats.variance,
      index,
    };
  });
  rows.sort((a, b) => {
    if (b.mean !== a.mean) return b.mean - a.mean;
    if (a.variance !== b.variance) return a.variance - b.variance;
    return a.index - b.index;
  });

  const top = rows[0];
  const champion = top
    ? {
        id: top.id,
        name: top.name,
        algorithm: top.algorithm,
        mean: top.mean,
        variance: top.variance,
        params: cloneParams(list[top.index].params),
      }
    : null;

  return {
    seeds: seeds.slice(),
    rows: rows.map(({ index, ...row }) => row),
    champion,
  };
}

function yieldNow() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeSeeds(count, rng) {
  return Array.from({ length: count }, () => (rng() * 0x100000000) >>> 0);
}

function clampScale(value) {
  return Math.max(0.35, Math.min(1.5, value));
}

function ladderCandidates(champion, population, rng, scale, flip) {
  const list = [{ params: cloneParams(champion.params), algorithm: champion.algorithm }];
  for (let i = 1; i < population; i++) {
    const explore = i % 2 === 0;
    const base = explore ? mixParams(champion.params, BASE_PARAMS, 0.35) : champion.params;
    const params = mutateParams(base, rng, gaussian, scale * (explore ? 0.55 : 0.85));
    let algorithm = champion.algorithm;
    if (flip > 0 && rng() < flip) algorithm = algorithm === "range" ? "minimax" : "range";
    list.push({ params, algorithm });
  }
  return list;
}

function defaultMeasure(candidate, champion, h2hSeeds, refSeeds, samples) {
  const h2h = duplicateMatch(
    candidate.params,
    champion.params,
    h2hSeeds.length,
    samples,
    null,
    20,
    h2hSeeds,
    candidate.algorithm,
    champion.algorithm,
  );
  const ref = duplicateMatch(
    candidate.params,
    BASE_PARAMS,
    refSeeds.length,
    samples,
    null,
    20,
    refSeeds,
    candidate.algorithm,
    "minimax",
  );
  const n = Math.min(h2h.perSeed.length, ref.perSeed.length);
  const deals = [];
  for (let i = 0; i < n; i++) deals.push(0.8 * seedBb(h2h.perSeed[i]) + 0.2 * seedBb(ref.perSeed[i]));
  return {
    h2h: h2h.bbPer100,
    ref: ref.bbPer100,
    fitness: 0.8 * h2h.bbPer100 + 0.2 * ref.bbPer100,
    deals,
  };
}

/**
 * Evolve one copy against a frozen champion until the deadline.
 * A child takes the seat only when its lead beats the sample noise and
 * the same lead shows up again on fresh deals. The score is mostly
 * paired bb/100 against the champion, with a small Baseline anchor.
 */
export async function trainLadder(options) {
  if (!options?.champion?.params) throw new Error("trainLadder needs a champion");
  const now = options.now || (() => Date.now());
  const deadline = Number.isFinite(options.deadline)
    ? options.deadline
    : now() + (Number(options.hours) || 0) * 3_600_000;
  const shouldStop = options.shouldStop || (() => false);
  const onProgress = options.onProgress || (() => {});
  const measure = options.measure || defaultMeasure;
  const rng = options.rng;
  const population = Math.max(2, Math.min(5, options.population || 3));
  const pairs = options.pairs || 24;
  const samples = options.samples ?? 4;
  const flip = Number.isFinite(options.algorithmFlip) ? options.algorithmFlip : 0.15;
  const maxSteps = Number.isFinite(options.maxSteps) ? options.maxSteps : Infinity;
  const source = options.champion;
  let scale = 1;
  let promotions = 0;
  let champion = {
    id: source.id ?? "",
    name: source.name ?? "Champion",
    algorithm: algorithmOf(source),
    params: cloneParams(source.params),
    generation: Number.isInteger(source.generation) && source.generation >= 0 ? source.generation : 0,
  };
  const history = [];
  let step = 0;

  function report(phase, fitness) {
    onProgress({
      step,
      phase,
      promotions,
      scale,
      fitness: fitness ?? null,
      deadline,
      champion: {
        id: champion.id,
        name: champion.name,
        algorithm: champion.algorithm,
        generation: champion.generation,
      },
    });
  }

  while (!shouldStop()) {
    if (step >= maxSteps) break;
    if (now() >= deadline) break;
    if (!rng) throw new Error("trainLadder needs rng");
    step += 1;
    const frozen = { params: cloneParams(champion.params), algorithm: champion.algorithm };
    const candidates = ladderCandidates(frozen, population, rng, scale, flip);
    const h2hSeeds = makeSeeds(pairs, rng);
    const refSeeds = makeSeeds(pairs, rng);
    let parent = null;
    let best = null;
    let aborted = false;
    for (let i = 0; i < candidates.length; i++) {
      if (shouldStop()) {
        aborted = true;
        break;
      }
      const score = await Promise.resolve(measure(candidates[i], frozen, h2hSeeds, refSeeds, samples));
      if (i === 0) {
        parent = { seat: candidates[0], score, index: 0 };
        best = parent;
      } else if (parent && leadsByNoise(score.deals, parent.score.deals) && score.fitness > best.score.fitness) {
        best = { seat: candidates[i], score, index: i };
      }
      report(`Screening ${i + 1}/${candidates.length}`, best?.score?.fitness);
      await yieldNow();
    }
    if (aborted || !parent?.score) break;

    let promoted = false;
    if (best.index !== 0) {
      report("Confirming", best.score.fitness);
      await yieldNow();
      if (shouldStop()) break;
      const confirmCount = Math.max(8, Math.min(pairs, Math.round(pairs * 0.5)));
      const freshH2h = makeSeeds(confirmCount, rng);
      const freshRef = makeSeeds(confirmCount, rng);
      const againParent = await Promise.resolve(measure(parent.seat, frozen, freshH2h, freshRef, samples));
      if (shouldStop()) break;
      const againChild = await Promise.resolve(measure(best.seat, frozen, freshH2h, freshRef, samples));
      if (leadsByNoise(againChild.deals, againParent.deals)) {
        champion = {
          ...champion,
          algorithm: best.seat.algorithm,
          params: cloneParams(best.seat.params),
          generation: champion.generation + 1,
        };
        promotions += 1;
        scale = clampScale(scale * 1.15);
        promoted = true;
      } else {
        scale = clampScale(scale * 0.85);
      }
    } else {
      scale = clampScale(scale * 0.85);
    }

    history.push({
      step,
      promoted,
      fitness: promoted ? best.score.fitness : parent.score.fitness,
      scale,
      algorithm: champion.algorithm,
    });
    report(promoted ? "Promoted" : "Held", history[history.length - 1].fitness);
    await yieldNow();
  }

  return { champion, promotions, scale, history };
}
