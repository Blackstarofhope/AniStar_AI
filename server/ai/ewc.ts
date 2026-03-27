import type { FFNetworkState } from "./forwardForward.js";
import { getActivations, infer } from "./forwardForward.js";

const EWC_LAMBDA = 80;
const REPLAY_CAPACITY = 500;

export interface ReplayEntry {
  animeId: number;
  embedding: number[];
  rating: number;
  timestamp: number;
}

export interface EWCState {
  fisher: number[][][];
  optimalWeights: number[][][];
  optimalBiases: number[][];
  replayBuffer: ReplayEntry[];
  totalReplayed: number;
}

export function createEWCState(): EWCState {
  return {
    fisher: [],
    optimalWeights: [],
    optimalBiases: [],
    replayBuffer: [],
    totalReplayed: 0,
  };
}

export function computeFisher(
  ewc: EWCState,
  net: FFNetworkState,
  dataset: { embedding: number[]; rating: number }[]
): void {
  const layers = net.layers;
  const fisher: number[][][] = layers.map((l) =>
    l.weights.map((row) => new Array(row.length).fill(0))
  );
  const fisherBias: number[][] = layers.map((l) => new Array(l.biases.length).fill(0));

  const n = Math.max(1, dataset.length);

  for (const sample of dataset) {
    const g = infer(net, sample.embedding);
    const prob = 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, g - net.threshold))));
    const label = sample.rating > 0.5 ? 1 : 0;
    const residual = (label - prob) ** 2;

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      for (let i = 0; i < layer.weights.length; i++) {
        for (let j = 0; j < layer.weights[i].length; j++) {
          fisher[li][i][j] += residual / n;
        }
      }
      for (let i = 0; i < layer.biases.length; i++) {
        (fisherBias[li] as number[])[i] += residual / n;
      }
    }
  }

  ewc.fisher = fisher;
  ewc.optimalWeights = layers.map((l) => l.weights.map((row) => [...row]));
  ewc.optimalBiases = layers.map((l) => [...l.biases]);
}

export function ewcPenalty(ewc: EWCState, net: FFNetworkState): number {
  if (ewc.fisher.length === 0) return 0;

  let penalty = 0;
  const layers = net.layers;

  for (let li = 0; li < Math.min(layers.length, ewc.fisher.length); li++) {
    const layer = layers[li];
    const fisher = ewc.fisher[li];
    const optW = ewc.optimalWeights[li];

    for (let i = 0; i < Math.min(layer.weights.length, fisher.length); i++) {
      for (let j = 0; j < Math.min(layer.weights[i].length, fisher[i].length); j++) {
        penalty +=
          fisher[i][j] * (layer.weights[i][j] - optW[i][j]) ** 2;
      }
    }
  }

  return (EWC_LAMBDA / 2) * penalty;
}

export function addToReplay(ewc: EWCState, entry: ReplayEntry): void {
  if (ewc.replayBuffer.length < REPLAY_CAPACITY) {
    ewc.replayBuffer.push(entry);
  } else {
    const idx = Math.floor(Math.random() * (ewc.totalReplayed + 1));
    if (idx < REPLAY_CAPACITY) {
      ewc.replayBuffer[idx] = entry;
    }
  }
  ewc.totalReplayed++;
}

export function sampleReplay(
  ewc: EWCState,
  n: number
): ReplayEntry[] {
  if (ewc.replayBuffer.length === 0) return [];
  const shuffled = [...ewc.replayBuffer].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

export function getReplayStats(ewc: EWCState): { size: number; capacity: number } {
  return {
    size: ewc.replayBuffer.length,
    capacity: REPLAY_CAPACITY,
  };
}
