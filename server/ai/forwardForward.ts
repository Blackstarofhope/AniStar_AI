import {
  kaiming, zerosVec, relu, layerNorm, normalize, sigmoid, goodness,
  matvec, addVec, scaleVec, outerProduct, addMatrix, scaleMatrix,
  cloneMatrix, cloneVec, randn, zeros
} from "./matrix.js";

export interface FFLayer {
  weights: number[][];
  biases: number[];
  phases: number[];
  goodnessWindow: number[];
  activationSum: number[];
}

export interface FFNetworkState {
  layers: FFLayer[];
  epoch: number;
  threshold: number;
  learningRate: number;
  goodnessHistory: number[];
}

const THRESHOLD = 2.0;
const LEARNING_RATE = 0.03;
const WINDOW_SIZE = 5;

export function createLayer(inputSize: number, outputSize: number): FFLayer {
  return {
    weights: kaiming(outputSize, inputSize),
    biases: zerosVec(outputSize),
    phases: Array.from({ length: outputSize }, () => Math.random() * 2 * Math.PI),
    goodnessWindow: [],
    activationSum: zerosVec(outputSize),
  };
}

export function createNetwork(layerSizes: number[]): FFNetworkState {
  const layers: FFLayer[] = [];
  for (let i = 0; i < layerSizes.length - 1; i++) {
    layers.push(createLayer(layerSizes[i], layerSizes[i + 1]));
  }
  return { layers, epoch: 0, threshold: THRESHOLD, learningRate: LEARNING_RATE, goodnessHistory: [] };
}

function layerForward(layer: FFLayer, input: number[]): number[] {
  const normed = normalize(input);
  const z = matvec(layer.weights, normed);
  const h = relu(addVec(z, layer.biases));
  return layerNorm(h);
}

function computeActivations(layer: FFLayer, input: number[]): { h: number[]; normedInput: number[] } {
  const normedInput = normalize(input);
  const z = matvec(layer.weights, normedInput);
  const h = relu(addVec(z, layer.biases));
  return { h, normedInput };
}

function trainLayerStep(
  layer: FFLayer,
  input: number[],
  isPositive: boolean,
  lr: number,
  threshold: number
): number {
  const { h, normedInput } = computeActivations(layer, input);
  const g = goodness(h);
  const label = isPositive ? 1 : 0;
  const prob = sigmoid(g - threshold);
  const delta = label - prob;

  const dhda = h.map((hi) => (hi > 0 ? 2 * hi : 0));
  const scaledGrad = scaleVec(dhda, lr * delta);

  const dW = outerProduct(scaledGrad, normedInput);
  layer.weights = addMatrix(layer.weights, dW);
  layer.biases = addVec(layer.biases, scaledGrad);

  for (let i = 0; i < h.length; i++) {
    layer.activationSum[i] += h[i];
  }

  return g;
}

export function trainStep(
  net: FFNetworkState,
  positiveInput: number[],
  negativeInput: number[]
): number {
  let totalGoodness = 0;
  let currentPos = positiveInput;
  let currentNeg = negativeInput;

  for (const layer of net.layers) {
    const g = trainLayerStep(layer, currentPos, true, net.learningRate, net.threshold);
    trainLayerStep(layer, currentNeg, false, net.learningRate, net.threshold);
    totalGoodness += g;

    currentPos = layerForward(layer, currentPos);
    currentNeg = layerForward(layer, currentNeg);
  }

  const normalizedG = totalGoodness / (net.layers.length || 1);
  net.goodnessHistory.push(normalizedG);
  if (net.goodnessHistory.length > 50) {
    net.goodnessHistory.shift();
  }
  net.epoch++;

  for (const layer of net.layers) {
    layer.goodnessWindow.push(normalizedG);
    if (layer.goodnessWindow.length > WINDOW_SIZE) {
      layer.goodnessWindow.shift();
    }
  }

  return normalizedG;
}

export function infer(net: FFNetworkState, input: number[]): number {
  let totalGoodness = 0;
  let current = input;
  for (const layer of net.layers) {
    const h = layerForward(layer, current);
    totalGoodness += goodness(h);
    current = h;
  }
  return totalGoodness / (net.layers.length || 1);
}

export function getActivations(net: FFNetworkState, input: number[]): number[] {
  const allActs: number[] = [];
  let current = input;
  for (const layer of net.layers) {
    const h = layerForward(layer, current);
    allActs.push(...h);
    current = h;
  }
  return allActs;
}

export function getLayerMeanGoodness(layer: FFLayer): number {
  if (layer.goodnessWindow.length === 0) return 0.5;
  return layer.goodnessWindow.reduce((s, g) => s + g, 0) / layer.goodnessWindow.length;
}

export function createCorruptedInput(input: number[]): number[] {
  const corrupted = [...input];
  const numFlip = Math.max(1, Math.floor(corrupted.length * 0.3));
  for (let i = 0; i < numFlip; i++) {
    const idx = Math.floor(Math.random() * corrupted.length);
    corrupted[idx] = randn() * 0.5;
  }
  return corrupted;
}

export function growLayer(layer: FFLayer, inputSize: number): FFLayer {
  const oldSize = layer.biases.length;
  const newNeurons = Math.max(1, Math.floor(oldSize * 0.2));
  const newSize = oldSize + newNeurons;
  const std = Math.sqrt(2 / inputSize);

  const newWeights = Array.from({ length: newNeurons }, () =>
    Array.from({ length: inputSize }, () => randn() * std)
  );

  return {
    weights: [...layer.weights, ...newWeights],
    biases: [...layer.biases, ...zerosVec(newNeurons)],
    phases: [...layer.phases, ...Array.from({ length: newNeurons }, () => Math.random() * 2 * Math.PI)],
    goodnessWindow: [...layer.goodnessWindow],
    activationSum: [...layer.activationSum, ...zerosVec(newNeurons)],
  };
}

export function pruneLayer(layer: FFLayer): FFLayer {
  const n = layer.biases.length;
  const pruneCount = Math.max(1, Math.floor(n * 0.1));
  if (n - pruneCount < 8) return layer;

  const indexed = layer.activationSum.map((s, i) => ({ s, i }));
  indexed.sort((a, b) => a.s - b.s);
  const keepIndices = new Set(indexed.slice(pruneCount).map((x) => x.i));

  return {
    weights: layer.weights.filter((_, i) => keepIndices.has(i)),
    biases: layer.biases.filter((_, i) => keepIndices.has(i)),
    phases: layer.phases.filter((_, i) => keepIndices.has(i)),
    goodnessWindow: [...layer.goodnessWindow],
    activationSum: layer.activationSum.filter((_, i) => keepIndices.has(i)),
  };
}

export function getTotalNeurons(net: FFNetworkState): number {
  return net.layers.reduce((s, l) => s + l.biases.length, 0);
}

export function serializeNetwork(net: FFNetworkState): object {
  return JSON.parse(JSON.stringify(net));
}

export function deserializeNetwork(data: unknown): FFNetworkState {
  return data as FFNetworkState;
}
