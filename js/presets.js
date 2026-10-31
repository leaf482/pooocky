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

export function normalizePreset(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "Imported preset").slice(0, 32);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newPresetId(),
    name,
    algorithm: "minimax",
    builtin: false,
    blurb: String(raw.blurb || "Saved minimax parameters.").slice(0, 140),
    params: sanitizeParams(raw.params),
    origin: raw.origin || "user",
    generation: Number.isFinite(raw.generation) ? raw.generation : null,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    stats: raw.stats && typeof raw.stats === "object" ? raw.stats : null,
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
  const store = storage();
  if (!store) return;
  const user = presets.filter((preset) => !preset.builtin).slice(-40);
  store.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      presets: user,
    }),
  );
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
