export const PARAM_META = [
  {
    key: "tightness",
    label: "Tightness",
    min: -0.22,
    max: 0.28,
    step: 0.01,
    hint: "Higher values fold more weak hands.",
  },
  {
    key: "aggression",
    label: "Aggression",
    min: 0.35,
    max: 2.4,
    step: 0.01,
    hint: "Higher values prefer bets and raises.",
  },
  {
    key: "bluff",
    label: "Bluff",
    min: 0,
    max: 0.45,
    step: 0.01,
    hint: "How often weak hands bet for fold equity.",
  },
  {
    key: "foldEquity",
    label: "Fold equity",
    min: 0.35,
    max: 1.9,
    step: 0.01,
    hint: "How often the opponent is assumed to fold.",
  },
  {
    key: "betMix",
    label: "Bet size",
    min: 0,
    max: 1,
    step: 0.01,
    hint: "0 prefers small bets. 1 prefers pot-sized bets.",
  },
  {
    key: "noise",
    label: "Noise",
    min: 0,
    max: 0.2,
    step: 0.01,
    hint: "Occasional off-strategy actions.",
  },
];

export const PARAM_KEYS = PARAM_META.map((m) => m.key);

export const STREET_TIGHT_META = [
  {
    key: "tightPre",
    label: "Preflop",
    min: -0.12,
    max: 0.12,
    step: 0.01,
    hint: "Added to tightness before the flop.",
  },
  {
    key: "tightFlop",
    label: "Flop",
    min: -0.12,
    max: 0.12,
    step: 0.01,
    hint: "Added to tightness on the flop.",
  },
  {
    key: "tightTurn",
    label: "Turn",
    min: -0.12,
    max: 0.12,
    step: 0.01,
    hint: "Added to tightness on the turn.",
  },
  {
    key: "tightRiver",
    label: "River",
    min: -0.12,
    max: 0.12,
    step: 0.01,
    hint: "Added to tightness on the river.",
  },
];

const ALL_META = [...PARAM_META, ...STREET_TIGHT_META];
const ALL_KEYS = ALL_META.map((meta) => meta.key);

export const BASE_PARAMS = Object.freeze({
  tightness: 0.02,
  aggression: 1,
  bluff: 0.08,
  foldEquity: 1,
  betMix: 0.45,
  noise: 0.03,
  tightPre: 0,
  tightFlop: 0,
  tightTurn: 0,
  tightRiver: 0,
});

export const TIGHT_PARAMS = Object.freeze({
  tightness: 0.08,
  aggression: 0.84,
  bluff: 0.03,
  foldEquity: 0.9,
  betMix: 0.28,
  noise: 0.02,
});

export const LOOSE_PARAMS = Object.freeze({
  tightness: -0.05,
  aggression: 1.22,
  bluff: 0.14,
  foldEquity: 1.1,
  betMix: 0.62,
  noise: 0.035,
});

const META_BY_KEY = Object.fromEntries(ALL_META.map((m) => [m.key, m]));

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function cloneParams(params) {
  return sanitizeParams(params);
}

export function sanitizeParams(params) {
  const out = { ...BASE_PARAMS };
  if (!params || typeof params !== "object") return out;
  for (const key of ALL_KEYS) {
    const meta = META_BY_KEY[key];
    const n = Number(params[key]);
    if (Number.isFinite(n)) out[key] = clamp(n, meta.min, meta.max);
  }
  return out;
}

export function mixParams(a, b, t) {
  const out = {};
  for (const key of ALL_KEYS) {
    out[key] = a[key] * (1 - t) + b[key] * t;
  }
  return sanitizeParams(out);
}

export function mutateParams(params, rng, gaussian, scale = 1, metas = PARAM_META) {
  const out = { ...sanitizeParams(params) };
  for (const meta of metas) {
    const span = (meta.max - meta.min) * 0.12 * scale;
    out[meta.key] = clamp(out[meta.key] + gaussian(rng) * span, meta.min, meta.max);
  }
  return out;
}
