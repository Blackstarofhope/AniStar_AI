import * as fs from "fs";
import * as path from "path";
import type { FFNetworkState } from "./forwardForward.js";
import type { KuramotoState } from "./kuramoto.js";
import type { NeurogenesisState } from "./neurogenesis.js";
import type { EWCState } from "./ewc.js";
import type { StarLearningState } from "./starLearning.js";

const MODEL_PATH = path.resolve(process.cwd(), "ai-model-state.json");

export interface ModelState {
  version: number;
  network: FFNetworkState;
  kuramoto: KuramotoState;
  neurogenesis: NeurogenesisState;
  ewc: EWCState;
  ratings: { animeId: number; embedding: number[]; rating: number; timestamp: number }[];
  allAnimeEmbeddings: { animeId: number; embedding: number[] }[];
  restTrainedAt?: number;
  savedAt: string;
  /** Star's chat learning state — optional so existing saves load cleanly. */
  starLearning?: StarLearningState;
}

// Version 3: infer() now measures goodness on pre-layerNorm activations.
// Old file-based saves had goodnessHistory calibrated to the layerNorm scale
// (~149/layer) — discard them so engines start fresh with correct variance.
// DB-stored engines only check layer shape, not version, so they load fine.
const CURRENT_VERSION = 3;

export function loadModelState(): ModelState | null {
  try {
    if (!fs.existsSync(MODEL_PATH)) return null;
    const raw = fs.readFileSync(MODEL_PATH, "utf-8");
    const state = JSON.parse(raw) as ModelState;
    if (state.version !== CURRENT_VERSION) {
      console.log("[AI] Model version mismatch, starting fresh");
      return null;
    }
    console.log(`[AI] Loaded model state (epoch ${state.network.epoch}, ${countNeurons(state)} neurons)`);
    return state;
  } catch (e) {
    console.warn("[AI] Failed to load model state:", e);
    return null;
  }
}

export function saveModelState(state: ModelState): void {
  try {
    state.savedAt = new Date().toISOString();
    state.version = CURRENT_VERSION;
    fs.writeFileSync(MODEL_PATH, JSON.stringify(state), "utf-8");
  } catch (e) {
    console.warn("[AI] Failed to save model state:", e);
  }
}

function countNeurons(state: ModelState): number {
  return state.network.layers.reduce((s, l) => s + l.biases.length, 0);
}

export function modelExists(): boolean {
  return fs.existsSync(MODEL_PATH);
}

export function deleteModelState(): void {
  try {
    if (fs.existsSync(MODEL_PATH)) {
      fs.unlinkSync(MODEL_PATH);
    }
  } catch {
    // ignore
  }
}
