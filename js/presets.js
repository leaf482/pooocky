import { BASE_PARAMS, LOOSE_PARAMS, TIGHT_PARAMS, cloneParams, sanitizeParams } from "./params.js";

export const STORAGE_KEY = "pooocky.presets.v1";

export function builtinPresets() {
  return [
    {
      id: "minimax-base",
      name: "미니맥스 기본",
      algorithm: "minimax",
      builtin: true,
      blurb: "에쿼티 계산 뒤 폴드·콜·리레이즈를 2수까지 비교하는 기준 스타일입니다.",
      params: cloneParams(BASE_PARAMS),
    },
    {
      id: "minimax-tight",
      name: "미니맥스 타이트",
      algorithm: "minimax",
      builtin: true,
      blurb: "강한 패 위주로 콜하고, 블러프와 큰 벳을 아낍니다.",
      params: cloneParams(TIGHT_PARAMS),
    },
    {
      id: "minimax-loose",
      name: "미니맥스 루즈",
      algorithm: "minimax",
      builtin: true,
      blurb: "넓은 레인지로 콜하고, 블러프와 큰 사이즈를 더 자주 씁니다.",
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
  const name = String(raw.name || "가져온 프리셋").slice(0, 32);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : newPresetId(),
    name,
    algorithm: "minimax",
    builtin: false,
    blurb: String(raw.blurb || "사용자가 저장한 미니맥스 파라미터입니다.").slice(0, 140),
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
