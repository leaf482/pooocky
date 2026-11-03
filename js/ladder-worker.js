import { rankPresets, rememberChampion, trainLadder } from "./ladder.js";
import { mulberry32 } from "./rng.js";

let stop = false;

function yieldToMessages() {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
}

function plainChampion(champion) {
  if (!champion?.params) return null;
  return {
    id: champion.id || "",
    name: champion.name || "Champion",
    algorithm: champion.algorithm === "range" ? "range" : "minimax",
    params: champion.params,
    generation: champion.generation || 0,
  };
}

self.onmessage = async (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "stop") {
    stop = true;
    return;
  }
  if (data.type !== "start") return;
  stop = false;
  const job = data.job || {};
  let hall = Array.isArray(job.hall) ? job.hall : [];
  let lastRerank = Number.isFinite(job.lastRerank) ? job.lastRerank : 0;
  try {
    const rng = mulberry32(Number.isFinite(job.rngState) ? job.rngState >>> 0 : (Math.random() * 0x100000000) >>> 0);
    let champ = plainChampion(job.champion);
    if (!job.resume) {
      await yieldToMessages();
      if (stop) {
        self.postMessage({ type: "done", stopped: true, result: null, hall, lastRerank });
        return;
      }
      const ranked = rankPresets(job.presets || [], { pairs: job.pairs, samples: job.samples, rng });
      champ = plainChampion(ranked.champion);
    }
    if (!champ) {
      self.postMessage({ type: "done", stopped: stop, result: null, hall, lastRerank });
      return;
    }
    const result = await trainLadder({
      champion: champ,
      hours: job.hours,
      deadline: job.deadline,
      scale: job.scale,
      promotions: job.promotions,
      quietSteps: job.quietSteps,
      population: job.population,
      pairs: job.pairs,
      samples: job.samples,
      rng,
      yield: yieldToMessages,
      shouldStop: () => stop,
      onPromoted: (info) => {
        hall = rememberChampion(hall, { ...info.champion, fitness: info.fitness });
        let replacement = null;
        if (Date.now() - lastRerank > 30 * 60 * 1000 && hall.length >= 2) {
          lastRerank = Date.now();
          const rankedHall = rankPresets(
            hall.map((row, index) => ({ ...row, id: `hall-${index}` })),
            { pairs: job.pairs, samples: job.samples, rng },
          );
          const top = rankedHall.champion;
          if (top && JSON.stringify(top.params) !== JSON.stringify(info.champion.params)) {
            replacement = hall.find((row) => JSON.stringify(row.params) === JSON.stringify(top.params)) || top;
          }
        }
        const seated = replacement || info.champion;
        self.postMessage({
          type: "checkpoint",
          info: { ...info, champion: plainChampion(seated), rngState: rng.getState() },
          hall,
          lastRerank,
        });
        return replacement;
      },
      onProgress: (info) => {
        self.postMessage({ type: "progress", info, hall, lastRerank });
      },
    });
    self.postMessage({
      type: "done",
      stopped: stop,
      result: {
        champion: result.champion,
        promotions: result.promotions,
        scale: result.scale,
        deadline: result.deadline,
        quietSteps: result.quietSteps,
        rngState: rng.getState(),
      },
      hall,
      lastRerank,
    });
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message || "Ladder error" });
  }
};
