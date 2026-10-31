export const PARAM_META = [
  {
    key: "tightness",
    label: "타이트함",
    min: -0.22,
    max: 0.28,
    step: 0.01,
    hint: "높으면 약한 패를 더 많이 버립니다.",
  },
  {
    key: "aggression",
    label: "공격성",
    min: 0.35,
    max: 2.4,
    step: 0.01,
    hint: "높으면 같은 패로도 벳과 레이즈를 더 선호합니다.",
  },
  {
    key: "bluff",
    label: "블러프",
    min: 0,
    max: 0.45,
    step: 0.01,
    hint: "약한 패로 폴드 에쿼티를 노리는 정도입니다.",
  },
  {
    key: "foldEquity",
    label: "폴드 에쿼티",
    min: 0.35,
    max: 1.9,
    step: 0.01,
    hint: "상대가 얼마큼 폴드할 것이라고 가정하는가입니다.",
  },
  {
    key: "betMix",
    label: "선호 사이즈",
    min: 0,
    max: 1,
    step: 0.01,
    hint: "0은 작은 벳, 1은 팟에 가까운 사이즈입니다.",
  },
  {
    key: "noise",
    label: "흔들림",
    min: 0,
    max: 0.2,
    step: 0.01,
    hint: "가끔 다른 수를 섞어 읽히지 않게 합니다.",
  },
];

export const PARAM_KEYS = PARAM_META.map((m) => m.key);

export const BASE_PARAMS = Object.freeze({
  tightness: 0.02,
  aggression: 1,
  bluff: 0.08,
  foldEquity: 1,
  betMix: 0.45,
  noise: 0.03,
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

const META_BY_KEY = Object.fromEntries(PARAM_META.map((m) => [m.key, m]));

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function cloneParams(params) {
  return sanitizeParams(params);
}

export function sanitizeParams(params) {
  const out = { ...BASE_PARAMS };
  if (!params || typeof params !== "object") return out;
  for (const key of PARAM_KEYS) {
    const meta = META_BY_KEY[key];
    const n = Number(params[key]);
    if (Number.isFinite(n)) out[key] = clamp(n, meta.min, meta.max);
  }
  return out;
}

export function mixParams(a, b, t) {
  const out = {};
  for (const key of PARAM_KEYS) {
    out[key] = a[key] * (1 - t) + b[key] * t;
  }
  return sanitizeParams(out);
}

export function mutateParams(params, rng, gaussian, scale = 1) {
  const out = { ...sanitizeParams(params) };
  for (const meta of PARAM_META) {
    const span = (meta.max - meta.min) * 0.12 * scale;
    out[meta.key] = clamp(out[meta.key] + gaussian(rng) * span, meta.min, meta.max);
  }
  return out;
}
