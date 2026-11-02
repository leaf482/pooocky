import { BASE_PARAMS, LOOSE_PARAMS, TIGHT_PARAMS, cloneParams, sanitizeParams } from "./params.js";

export const STORAGE_KEY = "pooocky.presets.v1";

export function builtinPresets() {
  return [
    {
      id: "minimax-base",
      name: "Baseline",
      algorithm: "minimax",
      builtin: true,
      blurb: "Estimates equity, then compares fold, call, and reraise two plies deep.",
      params: cloneParams(BASE_PARAMS),
    },
    {
      id: "minimax-tight",
      name: "Tight",
      algorithm: "minimax",
      builtin: true,
      blurb: "Continues with strong hands. Fewer bluffs and smaller bets.",
      params: cloneParams(TIGHT_PARAMS),
    },
    {
      id: "minimax-loose",
      name: "Loose",
      algorithm: "minimax",
      builtin: true,
      blurb: "Wider calls, more bluffs, and larger bet sizes.",
      params: cloneParams(LOOSE_PARAMS),
    },
    {
      id: "range-base",
      name: "Range",
      algorithm: "range",
      builtin: true,
      blurb: "Same two-ply bets, but equity is taken against hands that would still be in the pot.",
      params: cloneParams(BASE_PARAMS),
    },
  ];
}

function storage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function newPresetId() {
  return `p_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function cleanText(value, fallback, max) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return text || fallback;
}

function cleanId(id) {
  const text = String(id ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return text.length >= 4 ? text : newPresetId();
}

function cleanStat(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > 1e6) return null;
  return n;
}

function cleanStats(stats) {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return null;
  const ref = cleanStat(stats.ref);
  const h2h = cleanStat(stats.h2h);
  const out = {};
  if (ref != null) out.ref = ref;
  if (h2h != null) out.h2h = h2h;
  return out.ref == null && out.h2h == null ? null : out;
}

export function normalizePreset(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const generation = Number(raw.generation);
  return {
    id: cleanId(raw.id),
    name: cleanText(raw.name, "Imported preset", 32),
    algorithm: raw.algorithm === "range" ? "range" : "minimax",
    builtin: false,
    blurb: cleanText(raw.blurb, "Saved minimax parameters.", 140),
    params: sanitizeParams(raw.params),
    origin: raw.origin === "train" ? "train" : "user",
    generation: Number.isInteger(generation) && generation >= 0 && generation <= 999 ? generation : null,
    createdAt: Date.now(),
    stats: cleanStats(raw.stats),
  };
}

export function loadUserPresets() {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    const list = Array.isArray(data?.presets) ? data.presets : [];
    return list.map(normalizePreset).filter(Boolean);
  } catch {
    return [];
  }
}

export function saveUserPresets(presets) {
  const user = (Array.isArray(presets) ? presets : []).filter((preset) => preset && !preset.builtin).slice(-40);
  const store = storage();
  if (!store) return user;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ version: 1, presets: user }));
  } catch {
    return user;
  }
  return user;
}

export function allPresets(userPresets) {
  const builtins = builtinPresets();
  const ids = new Set(builtins.map((preset) => preset.id));
  const extra = [];
  for (const preset of userPresets) {
    if (ids.has(preset.id)) continue;
    ids.add(preset.id);
    extra.push(preset);
  }
  return [...builtins, ...extra];
}
