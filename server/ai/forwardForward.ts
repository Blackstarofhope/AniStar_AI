import {
  kaiming, zerosVec, relu, layerNorm, normalize, sigmoid, goodness,
  matvec, addVec, scaleVec, outerProduct, addMatrix, scaleMatrix,
  cloneVec, randn
} from "./matrix.js";

export interface FFLayer {
  weights: number[][];
  biases: number[];
  phases: number[];
  goodnessWindow: number[];
  activationSum: number[];
  activationEntropyWindow: number[];
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
    activationEntropyWindow: [],
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

function computeActivationEntropy(h: number[]): number {
  const sq = h.map((x) => x * x);
  const total = sq.reduce((s, v) => s + v, 0) + 1e-8;
  const probs = sq.map((v) => v / total);
  return -probs.reduce((s, p) => {
    if (p <= 0) return s;
    return s + p * Math.log(p + 1e-8);
  }, 0);
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

  const entropy = computeActivationEntropy(h);
  layer.activationEntropyWindow.push(entropy);
  if (layer.activationEntropyWindow.length > WINDOW_SIZE) {
    layer.activationEntropyWindow.shift();
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

export function applyEWCCorrection(
  net: FFNetworkState,
  fisher: number[][][],
  optimalWeights: number[][][],
  optimalBiases: number[][],
  lambda: number
): void {
  if (fisher.length === 0) return;
  const lr = net.learningRate;

  for (let li = 0; li < Math.min(net.layers.length, fisher.length); li++) {
    const layer = net.layers[li];
    const F = fisher[li];
    const Wstar = optimalWeights[li];
    const bstar = optimalBiases[li];
    if (!F || !Wstar) continue;

    for (let i = 0; i < Math.min(layer.weights.length, F.length, Wstar.length); i++) {
      for (let j = 0; j < Math.min(layer.weights[i].length, F[i]?.length ?? 0, Wstar[i]?.length ?? 0); j++) {
        const correction = lambda * F[i][j] * (layer.weights[i][j] - Wstar[i][j]);
        layer.weights[i][j] -= lr * correction;
      }
    }

    for (let i = 0; i < Math.min(layer.biases.length, bstar?.length ?? 0); i++) {
      const Fb = F[i]?.[0] ?? 0;
      const correction = lambda * Fb * (layer.biases[i] - bstar[i]);
      layer.biases[i] -= lr * correction;
    }
  }
}

// Returns pre-layerNorm activations (raw) for goodness measurement and the
// layerNorm output (prop) for propagation to the next layer.  Measuring
// goodness on raw activations keeps the score variable across inputs; if we
// measured on the layerNorm output the score would collapse to ~layerSize
// for every input because layerNorm forces mean=0, var=1.
function inferLayerActivations(
  layer: FFLayer,
  input: number[]
): { raw: number[]; prop: number[] } {
  const normedInput = normalize(input);
  const z = matvec(layer.weights, normedInput);
  const h = relu(addVec(z, layer.biases));
  return { raw: h, prop: layerNorm(h) };
}

export function infer(net: FFNetworkState, input: number[]): number {
  if (net.layers.length === 0) return 0.5;
  let totalNormGoodness = 0;
  let current = input;
  for (const layer of net.layers) {
    const { raw, prop } = inferLayerActivations(layer, current);
    // Divide goodness by layer width to get mean squared activation.
    // This normalises across layers of different sizes (a wider layer would
    // otherwise dominate the total) and keeps the value in a stable range
    // regardless of architecture. Typical fresh-network range: 0.3 – 0.7.
    totalNormGoodness += goodness(raw) / (raw.length || 1);
    // Propagate the layerNorm output, not the raw activations, so the next
    // layer receives a stable distribution (mean ≈ 0, var ≈ 1).
    current = prop;
  }
  // Average normalised goodness across layers, then map to (0, 1) with a
  // sigmoid centred at 0.5 (the typical fresh-network mean squared activation).
  // This keeps the output bounded and gives meaningful spread:
  //   avgNorm = 0.3  →  sigmoid(−0.8) ≈ 0.31  (network finds input unlikely)
  //   avgNorm = 0.5  →  sigmoid( 0.0) = 0.50  (neutral / untrained)
  //   avgNorm = 0.7  →  sigmoid(+0.8) ≈ 0.69  (network prefers this input)
  //   avgNorm = 1.0  →  sigmoid(+2.0) ≈ 0.88  (strongly preferred)
  const avgNorm = totalNormGoodness / net.layers.length;
  return sigmoid(4 * (avgNorm - 0.5));
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

export function getLayerActivationEntropy(layer: FFLayer): number {
  if (layer.activationEntropyWindow.length === 0) return Math.log(layer.biases.length || 1);
  return layer.activationEntropyWindow.reduce((s, e) => s + e, 0) / layer.activationEntropyWindow.length;
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
  const std = Math.sqrt(2 / (inputSize || 1));

  const newWeights = Array.from({ length: newNeurons }, () =>
    Array.from({ length: inputSize }, () => randn() * std)
  );

  return {
    weights: [...layer.weights, ...newWeights],
    biases: [...layer.biases, ...zerosVec(newNeurons)],
    phases: [...layer.phases, ...Array.from({ length: newNeurons }, () => Math.random() * 2 * Math.PI)],
    goodnessWindow: [...layer.goodnessWindow],
    activationSum: [...layer.activationSum, ...zerosVec(newNeurons)],
    activationEntropyWindow: [...layer.activationEntropyWindow],
  };
}

export function pruneLayer(layer: FFLayer): FFLayer {
  return pruneLayerWithIndices(layer).newLayer;
}

export function pruneLayerWithIndices(
  layer: FFLayer
): { newLayer: FFLayer; keptIndices: Set<number> } {
  const n = layer.biases.length;
  const pruneCount = Math.max(1, Math.floor(n * 0.1));
  if (n - pruneCount < 8) {
    const allIndices = new Set<number>(Array.from({ length: n }, (_, i) => i));
    return { newLayer: layer, keptIndices: allIndices };
  }

  const indexed = layer.activationSum.map((s, i) => ({ s, i }));
  indexed.sort((a, b) => a.s - b.s);
  const keptIndices = new Set(indexed.slice(pruneCount).map((x) => x.i));

  return {
    newLayer: {
      weights: layer.weights.filter((_, i) => keptIndices.has(i)),
      biases: layer.biases.filter((_, i) => keptIndices.has(i)),
      phases: layer.phases.filter((_, i) => keptIndices.has(i)),
      goodnessWindow: [...layer.goodnessWindow],
      activationSum: layer.activationSum.filter((_, i) => keptIndices.has(i)),
      activationEntropyWindow: [...layer.activationEntropyWindow],
    },
    keptIndices,
  };
}

export function getTotalNeurons(net: FFNetworkState): number {
  return net.layers.reduce((s, l) => s + l.biases.length, 0);
}

export function serializeNetwork(net: FFNetworkState): object {
  return JSON.parse(JSON.stringify(net));
}

export function deserializeNetwork(data: unknown): FFNetworkState {
  const d = data as FFNetworkState;
  if (d.layers) {
    for (const layer of d.layers) {
      if (!layer.activationEntropyWindow) {
        layer.activationEntropyWindow = [];
      }
    }
  }
  return d;
}
