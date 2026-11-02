import { duplicateMatch } from "./play.js";
import { cloneParams } from "./params.js";

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
