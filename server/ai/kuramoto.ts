export interface KuramotoState {
  textPhases: number[];
  visionPhases: number[];
  vibePhases: number[];
  naturalFrequencies: number[];
  coupling: number;
  orderHistory: number[];
}

function ensureVibePhases(state: KuramotoState): void {
  if (!state.vibePhases || state.vibePhases.length !== state.textPhases.length) {
    state.vibePhases = Array.from({ length: state.textPhases.length }, () => Math.random() * TWO_PI);
  }
}

const TWO_PI = 2 * Math.PI;
const DT = 0.05;

export function createKuramotoSystem(size: number): KuramotoState {
  return {
    textPhases: Array.from({ length: size }, () => Math.random() * TWO_PI),
    visionPhases: Array.from({ length: size }, () => Math.random() * TWO_PI),
    vibePhases: Array.from({ length: size }, () => Math.random() * TWO_PI),
    naturalFrequencies: Array.from({ length: size }, () => (Math.random() - 0.5) * 0.8),
    coupling: 0.5,
    orderHistory: [],
  };
}

function kuramotoStep(
  phases: number[],
  naturalFreqs: number[],
  coupling: number,
  dt: number
): number[] {
  const n = phases.length;
  return phases.map((theta_i, i) => {
    let interaction = 0;
    for (let j = 0; j < n; j++) {
      interaction += Math.sin(phases[j] - theta_i);
    }
    const dtheta = naturalFreqs[i] + (coupling / n) * interaction;
    return (theta_i + dtheta * dt + TWO_PI) % TWO_PI;
  });
}

export function stepKuramoto(state: KuramotoState, steps = 1): void {
  ensureVibePhases(state);
  for (let s = 0; s < steps; s++) {
    // Intra-modal steps
    state.textPhases = kuramotoStep(state.textPhases, state.naturalFrequencies, state.coupling, DT);
    state.visionPhases = kuramotoStep(state.visionPhases, state.naturalFrequencies, state.coupling, DT);
    state.vibePhases = kuramotoStep(state.vibePhases, state.naturalFrequencies, state.coupling, DT);

    const crossCoupling = state.coupling * 0.3;
    const n = state.textPhases.length;

    // text ← vision (existing) + text ← vibe (new)
    const newText = state.textPhases.map((theta_i) => {
      let interaction = 0;
      for (let j = 0; j < n; j++) {
        interaction += Math.sin(state.visionPhases[j] - theta_i);
        interaction += Math.sin(state.vibePhases[j] - theta_i);
      }
      return (theta_i + (crossCoupling / n) * interaction * DT + TWO_PI) % TWO_PI;
    });

    // vision ← text (unchanged)
    const newVision = state.visionPhases.map((theta_i) => {
      let interaction = 0;
      for (let j = 0; j < n; j++) {
        interaction += Math.sin(state.textPhases[j] - theta_i);
      }
      return (theta_i + (crossCoupling / n) * interaction * DT + TWO_PI) % TWO_PI;
    });

    // vibe ← text (new)
    const newVibe = state.vibePhases.map((theta_i) => {
      let interaction = 0;
      for (let j = 0; j < n; j++) {
        interaction += Math.sin(state.textPhases[j] - theta_i);
      }
      return (theta_i + (crossCoupling / n) * interaction * DT + TWO_PI) % TWO_PI;
    });

    state.textPhases = newText;
    state.visionPhases = newVision;
    state.vibePhases = newVibe;
  }
}

export function orderParameter(phases: number[]): number {
  const n = phases.length;
  let sinSum = 0;
  let cosSum = 0;
  for (const theta of phases) {
    sinSum += Math.sin(theta);
    cosSum += Math.cos(theta);
  }
  return Math.sqrt((sinSum / n) ** 2 + (cosSum / n) ** 2);
}

export function synchronyIndex(state: KuramotoState): number {
  ensureVibePhases(state);
  const textOrder = orderParameter(state.textPhases);
  const visionOrder = orderParameter(state.visionPhases);
  const vibeOrder = orderParameter(state.vibePhases);
  const combined = [...state.textPhases, ...state.visionPhases, ...state.vibePhases];
  const globalOrder = orderParameter(combined);
  return (textOrder + visionOrder + vibeOrder + globalOrder) / 4;
}

export function updateCouplingFromGoodness(state: KuramotoState, goodness: number): void {
  const target = 0.3 + goodness * 0.7;
  state.coupling = state.coupling * 0.95 + target * 0.05;
  state.coupling = Math.max(0.1, Math.min(2.0, state.coupling));
}

export function phaseModulatedEmbedding(
  embedding: number[],
  phases: number[]
): number[] {
  const n = Math.min(embedding.length, phases.length);
  return embedding.map((v, i) => {
    if (i < n) {
      const phaseWeight = 0.5 + 0.5 * Math.cos(phases[i % n]);
      return v * phaseWeight;
    }
    return v;
  });
}

export function phaseModulatedVibeEmbedding(
  embedding: number[],
  state: KuramotoState
): number[] {
  ensureVibePhases(state);
  const phases = state.vibePhases;
  const n = Math.min(embedding.length, phases.length);
  return embedding.map((v, i) => {
    if (i < n) {
      const phaseWeight = 0.5 + 0.5 * Math.cos(phases[i % n]);
      return v * phaseWeight;
    }
    return v;
  });
}

export function alignVisionPhasesToEmbedding(
  state: KuramotoState,
  visionEmbedding: number[]
): void {
  const n = Math.min(state.visionPhases.length, visionEmbedding.length);
  for (let i = 0; i < n; i++) {
    const signal = visionEmbedding[i];
    const targetPhase = Math.acos(Math.max(-1, Math.min(1, signal)));
    const diff = targetPhase - state.visionPhases[i];
    state.visionPhases[i] = (state.visionPhases[i] + 0.05 * diff + 2 * Math.PI) % (2 * Math.PI);
  }
}

export function updateOrderHistory(state: KuramotoState): void {
  const R = synchronyIndex(state);
  state.orderHistory.push(R);
  if (state.orderHistory.length > 100) {
    state.orderHistory.shift();
  }
}

export function resizeKuramoto(state: KuramotoState, newSize: number): void {
  ensureVibePhases(state);
  const oldSize = state.textPhases.length;
  if (newSize > oldSize) {
    const diff = newSize - oldSize;
    state.textPhases.push(...Array.from({ length: diff }, () => Math.random() * TWO_PI));
    state.visionPhases.push(...Array.from({ length: diff }, () => Math.random() * TWO_PI));
    state.vibePhases.push(...Array.from({ length: diff }, () => Math.random() * TWO_PI));
    state.naturalFrequencies.push(...Array.from({ length: diff }, () => (Math.random() - 0.5) * 2));
  } else if (newSize < oldSize) {
    state.textPhases = state.textPhases.slice(0, newSize);
    state.visionPhases = state.visionPhases.slice(0, newSize);
    state.vibePhases = state.vibePhases.slice(0, newSize);
    state.naturalFrequencies = state.naturalFrequencies.slice(0, newSize);
  }
}
