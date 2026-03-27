import type { FFNetworkState, FFLayer } from "./forwardForward.js";
import {
  growLayer, pruneLayerWithIndices, getLayerActivationEntropy
} from "./forwardForward.js";
import { resizeKuramoto, type KuramotoState } from "./kuramoto.js";
import { randn } from "./matrix.js";

const ENTROPY_THRESHOLD_LOW = 0.2;
const ENTROPY_THRESHOLD_HIGH = 0.85;
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

function growNextLayerInputs(nextLayer: FFLayer, numNew: number): void {
  const inputSize = nextLayer.weights[0]?.length ?? 0;
  const std = Math.sqrt(2 / (inputSize + numNew));
  for (let i = 0; i < nextLayer.weights.length; i++) {
    for (let n = 0; n < numNew; n++) {
      nextLayer.weights[i].push(randn() * std);
    }
  }
}

function pruneNextLayerInputs(nextLayer: FFLayer, keepIndices: Set<number>): void {
  for (let i = 0; i < nextLayer.weights.length; i++) {
    nextLayer.weights[i] = nextLayer.weights[i].filter((_, j) => keepIndices.has(j));
  }
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
    const layer = net.layers[i];
    const entropy = getLayerActivationEntropy(layer);
    const maxEntropy = Math.log(layer.biases.length + 1);
    const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0.5;

    if (normalizedEntropy < ENTROPY_THRESHOLD_LOW) {
      ngState.epochsBelowThreshold[i]++;
      ngState.epochsAboveThreshold[i] = 0;
    } else if (normalizedEntropy > ENTROPY_THRESHOLD_HIGH) {
      ngState.epochsAboveThreshold[i]++;
      ngState.epochsBelowThreshold[i] = 0;
    } else {
      ngState.epochsBelowThreshold[i] = Math.max(0, ngState.epochsBelowThreshold[i] - 1);
      ngState.epochsAboveThreshold[i] = Math.max(0, ngState.epochsAboveThreshold[i] - 1);
    }

    if (
      ngState.epochsBelowThreshold[i] >= EPOCHS_TO_TRIGGER &&
      layer.biases.length < MAX_NEURONS_PER_LAYER
    ) {
      const oldSize = layer.biases.length;
      net.layers[i] = growLayer(layer, layerInputSizes[i]);
      const numNew = net.layers[i].biases.length - oldSize;
      ngState.epochsBelowThreshold[i] = 0;
      ngState.growthEvents++;
      grown = true;

      if (i + 1 < net.layers.length) {
        growNextLayerInputs(net.layers[i + 1], numNew);
      }

      const newSize = net.layers[i].biases.length;
      resizeKuramoto(kuramoto, newSize);
    }

    if (
      ngState.epochsAboveThreshold[i] >= EPOCHS_TO_TRIGGER &&
      layer.biases.length > MIN_NEURONS_PER_LAYER
    ) {
      const { newLayer, keptIndices } = pruneLayerWithIndices(layer);
      net.layers[i] = newLayer;
      ngState.epochsAboveThreshold[i] = 0;
      ngState.pruneEvents++;
      pruned = true;

      if (i + 1 < net.layers.length) {
        pruneNextLayerInputs(net.layers[i + 1], keptIndices);
      }
    }
  }

  return { grown, pruned };
}

function getLayerInputSizes(net: FFNetworkState): number[] {
  const sizes: number[] = [];
  for (const layer of net.layers) {
    sizes.push(layer.weights.length > 0 ? layer.weights[0].length : 0);
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
