import { duplicateMatch } from "./play.js";
import { BASE_PARAMS, BET_SIZE_META, RANGE_OPEN_META, STREET_TIGHT_META, cloneParams, mixParams, mutateParams } from "./params.js";
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

export const GENE_GATES = Object.freeze({ street: 6, range: 12, bets: 18 });

/** Extra genes open only after the mutation width is at its floor. */
export function geneTier(scale, quietSteps) {
  if (!(Number(scale) <= 0.351)) return "";
  const quiet = Number.isInteger(quietSteps) && quietSteps > 0 ? quietSteps : 0;
  if (quiet >= GENE_GATES.bets) return "Bet sizes";
  if (quiet >= GENE_GATES.range) return "Continue range";
  if (quiet >= GENE_GATES.street) return "Street tightness";
  return "";
}

/** Steps per hour once a minute of the run has elapsed. */
export function formatPace(steps, elapsedMs) {
  if (!Number.isFinite(steps) || steps < 1) return "";
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) return "";
  const rate = steps / (elapsedMs / 3_600_000);
  if (!Number.isFinite(rate) || rate <= 0) return "";
  const text = rate >= 100 ? String(Math.round(rate)) : rate.toFixed(1);
  return `${text} steps/h`;
}

/** Confirming scores, oldest promotion first. Rows without a score are skipped. */
export function promotionScores(hall) {
  if (!Array.isArray(hall)) return [];
  const scores = [];
  for (const row of hall) {
    const n = row?.fitness;
    if (typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e6) scores.push(n);
  }
  return scores;
}

function ladderCandidates(champion, population, rng, scale, flip, widen, openRange, splitBets) {
  const list = [{ params: cloneParams(champion.params), algorithm: champion.algorithm }];
  for (let i = 1; i < population; i++) {
    const explore = i % 2 === 0;
    const base = explore ? mixParams(champion.params, BASE_PARAMS, 0.35) : champion.params;
    const factor = scale * (explore ? 0.55 : 0.85);
    let params = mutateParams(base, rng, gaussian, factor);
    if (widen) params = mutateParams(params, rng, gaussian, factor, STREET_TIGHT_META);
    if (openRange) params = mutateParams(params, rng, gaussian, factor, RANGE_OPEN_META);
    if (splitBets) params = mutateParams(params, rng, gaussian, factor, BET_SIZE_META);
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
 * A child takes the seat only when its lead clears two standard errors
 * and the same lead shows up on a fresh pack. A promotion keeps the
 * mutation width. The score is mostly paired bb/100 against the champion,
 * with a small Baseline anchor.
 */
export async function trainLadder(options) {
  if (!options?.champion?.params) throw new Error("trainLadder needs a champion");
  const now = options.now || (() => Date.now());
  const deadline = Number.isFinite(options.deadline)
    ? options.deadline
    : now() + (Number(options.hours) || 0) * 3_600_000;
  const shouldStop = options.shouldStop || (() => false);
  const onProgress = options.onProgress || (() => {});
  const yieldTurn = options.yield || yieldNow;
  const measure = options.measure || defaultMeasure;
  const rng = options.rng;
  const population = Math.max(2, Math.min(5, options.population || 3));
  const pairs = options.pairs || 24;
  const samples = options.samples ?? 4;
  const flip = Number.isFinite(options.algorithmFlip) ? options.algorithmFlip : 0.15;
  const margin = Number.isFinite(options.margin) && options.margin > 0 ? options.margin : 2;
  const widenAfter = Number.isInteger(options.widenAfter) && options.widenAfter >= 0 ? options.widenAfter : GENE_GATES.street;
  const rangeAfter = Number.isInteger(options.rangeAfter) && options.rangeAfter >= 0 ? options.rangeAfter : GENE_GATES.range;
  const betAfter = Number.isInteger(options.betAfter) && options.betAfter >= 0 ? options.betAfter : GENE_GATES.bets;
  const maxSteps = Number.isFinite(options.maxSteps) ? options.maxSteps : Infinity;
  const source = options.champion;
  let scale = clampScale(Number.isFinite(options.scale) ? options.scale : 1);
  let champion = {
    id: source.id ?? "",
    name: source.name ?? "Champion",
    algorithm: algorithmOf(source),
    params: cloneParams(source.params),
    generation: Number.isInteger(source.generation) && source.generation >= 0 ? source.generation : 0,
  };
  let promotions =
    Number.isInteger(options.promotions) && options.promotions >= 0 ? options.promotions : champion.generation;
  const history = [];
  let step = 0;
  let quietSteps = Number.isInteger(options.quietSteps) && options.quietSteps >= 0 ? options.quietSteps : 0;

  function report(phase, fitness) {
    onProgress({
      step,
      phase,
      promotions,
      scale,
      quietSteps,
      fitness: fitness ?? null,
      deadline,
      rngState: typeof rng.getState === "function" ? rng.getState() : null,
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
    const widen = scale <= 0.351 && quietSteps >= widenAfter;
    const openRange = scale <= 0.351 && quietSteps >= rangeAfter;
    const splitBets = scale <= 0.351 && quietSteps >= betAfter;
    const candidates = ladderCandidates(frozen, population, rng, scale, flip, widen, openRange, splitBets);
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
      } else if (parent && leadsByNoise(score.deals, parent.score.deals, margin) && score.fitness > best.score.fitness) {
        best = { seat: candidates[i], score, index: i };
      }
      report(`Screening ${i + 1}/${candidates.length}`, best?.score?.fitness);
      await yieldTurn();
    }
    if (aborted || !parent?.score) break;

    let promoted = false;
    let promotedFitness = null;
    if (best.index !== 0) {
      report("Confirming", best.score.fitness);
      await yieldTurn();
      if (shouldStop()) break;
      const confirmCount = Math.max(pairs, 16);
      const freshH2h = makeSeeds(confirmCount, rng);
      const freshRef = makeSeeds(confirmCount, rng);
      const againParent = await Promise.resolve(measure(parent.seat, frozen, freshH2h, freshRef, samples));
      if (shouldStop()) break;
      const againChild = await Promise.resolve(measure(best.seat, frozen, freshH2h, freshRef, samples));
      if (leadsByNoise(againChild.deals, againParent.deals, margin)) {
        champion = {
          ...champion,
          algorithm: best.seat.algorithm,
          params: cloneParams(best.seat.params),
          generation: champion.generation + 1,
        };
        promotions += 1;
        promoted = true;
        promotedFitness = againChild.fitness;
      } else {
        scale = clampScale(scale * 0.85);
      }
    } else {
      scale = clampScale(scale * 0.85);
    }
    quietSteps = promoted ? 0 : quietSteps + 1;
    if (promoted && options.onPromoted) {
      try {
        const next = await Promise.resolve(
          options.onPromoted({
            champion,
            scale,
            promotions,
            quietSteps,
            fitness: promotedFitness,
            deadline,
            rngState: typeof rng.getState === "function" ? rng.getState() : null,
          }),
        );
        if (next?.params) {
          champion = {
            id: next.id ?? champion.id,
            name: next.name || champion.name,
            algorithm: algorithmOf(next),
            params: cloneParams(next.params),
            generation: Number.isInteger(next.generation) && next.generation >= 0 ? next.generation : champion.generation,
          };
        }
      } catch (error) {
        console.error(error);
      }
    }

    history.push({
      step,
      promoted,
      fitness: promoted ? best.score.fitness : parent.score.fitness,
      scale,
      algorithm: champion.algorithm,
    });
    report(promoted ? "Promoted" : "Held", history[history.length - 1].fitness);
    await yieldTurn();
  }

  return { champion, promotions, scale, quietSteps, history, deadline };
}

export const LADDER_KEY = "pooocky.ladder.v1";

function ladderStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function cleanName(value) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return text || "Champion";
}

function cleanGeneration(value) {
  return Number.isInteger(value) && value >= 0 && value <= 9999 ? value : 0;
}

function cleanFitness(value) {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= 1e6 ? n : null;
}

function cleanChampion(raw) {
  if (!raw?.params) return null;
  return {
    id: typeof raw.id === "string" ? raw.id.slice(0, 40) : "",
    name: cleanName(raw.name),
    algorithm: algorithmOf(raw),
    params: cloneParams(raw.params),
    generation: cleanGeneration(raw.generation),
    fitness: cleanFitness(raw.fitness),
  };
}

/** Keep the newest eight champions and a run that still has time left. */
export function normalizeLadder(raw, now = Date.now()) {
  const hall = [];
  const source = Array.isArray(raw?.hall) ? raw.hall : [];
  for (const row of source) {
    const champion = cleanChampion(row);
    if (champion) hall.push(champion);
  }
  const kept = hall.slice(-8);
  const runSource = raw?.run;
  const champion = cleanChampion(runSource?.champion);
  const deadline = Number(runSource?.deadline);
  if (!champion || !Number.isFinite(deadline) || !(deadline > now)) {
    return { hall: kept, run: null, lastRerank: 0 };
  }
  const scale = Number(runSource.scale);
  const population = Math.round(Number(runSource.population));
  const pairs = Math.round(Number(runSource.pairs));
  const samples = Math.round(Number(runSource.samples));
  const hours = Math.round(Number(runSource.hours));
  const rngState = Number(runSource.rngState);
  const lastRerank = Number(runSource.lastRerank);
  return {
    hall: kept,
    lastRerank: Number.isFinite(lastRerank) && lastRerank > 0 ? lastRerank : 0,
    run: {
      champion,
      scale: clampScale(Number.isFinite(scale) ? scale : 1),
      promotions: cleanGeneration(runSource.promotions),
      deadline,
      population: Math.max(2, Math.min(5, Number.isFinite(population) ? population : 3)),
      pairs: Math.max(8, Math.min(80, Number.isFinite(pairs) ? pairs : 24)),
      samples: Math.max(1, Math.min(8, Number.isFinite(samples) ? samples : 4)),
      hours: Math.max(1, Math.min(12, Number.isFinite(hours) ? hours : 1)),
      rngState: Number.isFinite(rngState) ? rngState >>> 0 : null,
      quietSteps: cleanGeneration(runSource.quietSteps),
      lastRerank: Number.isFinite(lastRerank) && lastRerank > 0 ? lastRerank : 0,
    },
  };
}

export function rememberChampion(hall, champion) {
  return normalizeLadder({ hall: [...(Array.isArray(hall) ? hall : []), champion] }, Number.POSITIVE_INFINITY).hall;
}

export function loadLadder(now = Date.now()) {
  const store = ladderStorage();
  if (!store) return normalizeLadder(null, now);
  try {
    return normalizeLadder(JSON.parse(store.getItem(LADDER_KEY) || "null"), now);
  } catch {
    return normalizeLadder(null, now);
  }
}

export function saveLadder(data, now = Date.now()) {
  const clean = normalizeLadder(data, now);
  const store = ladderStorage();
  if (!store) return clean;
  try {
    store.setItem(LADDER_KEY, JSON.stringify({ version: 1, hall: clean.hall, run: clean.run }));
  } catch {
    return clean;
  }
  return clean;
}
