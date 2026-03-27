import type { FFNetworkState, FFLayer } from "./forwardForward.js";
import {
  growLayer, pruneLayer, getLayerMeanGoodness, getTotalNeurons
} from "./forwardForward.js";
import { resizeKuramoto, type KuramotoState } from "./kuramoto.js";

const THETA_LOW = 0.15;
const THETA_HIGH = 0.85;
const EPOCHS_TO_TRIGGER = 5;
const MAX_NEURONS_PER_LAYER = 512;
const MIN_NEURONS_PER_LAYER = 8;

export interface NeurogenesisState {
  epochsBelowThreshold: number[];
  epochsAboveThreshold: number[];
  growthEvents: number;
  pruneEvents: number;
}

export function createNeurogenesisState(numLayers: number): NeurogenesisState {
  return {
    epochsBelowThreshold: new Array(numLayers).fill(0),
    epochsAboveThreshold: new Array(numLayers).fill(0),
    growthEvents: 0,
    pruneEvents: 0,
  };
}

export function checkNeurogenesis(
  net: FFNetworkState,
  ngState: NeurogenesisState,
  kuramoto: KuramotoState
): { grown: boolean; pruned: boolean } {
  let grown = false;
  let pruned = false;

  while (ngState.epochsBelowThreshold.length < net.layers.length) {
    ngState.epochsBelowThreshold.push(0);
  }
  while (ngState.epochsAboveThreshold.length < net.layers.length) {
    ngState.epochsAboveThreshold.push(0);
  }

  const layerInputSizes = getLayerInputSizes(net);

  for (let i = 0; i < net.layers.length; i++) {
    const meanG = getLayerMeanGoodness(net.layers[i]);
    const normalized = Math.min(1, meanG / 10);

    if (normalized < THETA_LOW) {
      ngState.epochsBelowThreshold[i]++;
      ngState.epochsAboveThreshold[i] = 0;
    } else if (normalized > THETA_HIGH) {
      ngState.epochsAboveThreshold[i]++;
      ngState.epochsBelowThreshold[i] = 0;
    } else {
      ngState.epochsBelowThreshold[i] = Math.max(0, ngState.epochsBelowThreshold[i] - 1);
      ngState.epochsAboveThreshold[i] = Math.max(0, ngState.epochsAboveThreshold[i] - 1);
    }

    if (
      ngState.epochsBelowThreshold[i] >= EPOCHS_TO_TRIGGER &&
      net.layers[i].biases.length < MAX_NEURONS_PER_LAYER
    ) {
      net.layers[i] = growLayer(net.layers[i], layerInputSizes[i]);
      ngState.epochsBelowThreshold[i] = 0;
      ngState.growthEvents++;
      grown = true;

      const newSize = net.layers[i].biases.length;
      resizeKuramoto(kuramoto, newSize);
    }

    if (
      ngState.epochsAboveThreshold[i] >= EPOCHS_TO_TRIGGER &&
      net.layers[i].biases.length > MIN_NEURONS_PER_LAYER
    ) {
      net.layers[i] = pruneLayer(net.layers[i]);
      ngState.epochsAboveThreshold[i] = 0;
      ngState.pruneEvents++;
      pruned = true;
    }
  }

  return { grown, pruned };
}

function getLayerInputSizes(net: FFNetworkState): number[] {
  const sizes: number[] = [];
  for (let i = 0; i < net.layers.length; i++) {
    if (net.layers[i].weights.length > 0) {
      sizes.push(net.layers[i].weights[0].length);
    } else {
      sizes.push(0);
    }
  }
  return sizes;
}

export function syncNeurogenesisState(
  ngState: NeurogenesisState,
  numLayers: number
): void {
  while (ngState.epochsBelowThreshold.length < numLayers) {
    ngState.epochsBelowThreshold.push(0);
  }
  while (ngState.epochsAboveThreshold.length < numLayers) {
    ngState.epochsAboveThreshold.push(0);
  }
  ngState.epochsBelowThreshold = ngState.epochsBelowThreshold.slice(0, numLayers);
  ngState.epochsAboveThreshold = ngState.epochsAboveThreshold.slice(0, numLayers);
}
