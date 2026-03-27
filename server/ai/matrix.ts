export function zeros(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

export function zerosVec(n: number): number[] {
  return new Array(n).fill(0);
}

export function kaiming(rows: number, cols: number): number[][] {
  const std = Math.sqrt(2 / cols);
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => randn() * std)
  );
}

export function randn(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function matvec(M: number[][], x: number[]): number[] {
  return M.map((row) => row.reduce((s, w, j) => s + w * x[j], 0));
}

export function relu(v: number[]): number[] {
  return v.map((x) => Math.max(0, x));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, x))));
}

export function layerNorm(v: number[]): number[] {
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const variance =
    v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length;
  const std = Math.sqrt(variance + 1e-8);
  return v.map((x) => (x - mean) / std);
}

export function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) + 1e-8;
  return v.map((x) => x / norm);
}

export function dot(a: number[], b: number[]): number {
  return a.reduce((s, x, i) => s + x * b[i], 0);
}

export function cosineSim(a: number[], b: number[]): number {
  const na = Math.sqrt(a.reduce((s, x) => s + x * x, 0)) + 1e-8;
  const nb = Math.sqrt(b.reduce((s, x) => s + x * x, 0)) + 1e-8;
  return dot(a, b) / (na * nb);
}

export function addVec(a: number[], b: number[]): number[] {
  return a.map((x, i) => x + b[i]);
}

export function scaleVec(v: number[], s: number): number[] {
  return v.map((x) => x * s);
}

export function cloneMatrix(M: number[][]): number[][] {
  return M.map((row) => [...row]);
}

export function cloneVec(v: number[]): number[] {
  return [...v];
}

export function outerProduct(a: number[], b: number[]): number[][] {
  return a.map((ai) => b.map((bi) => ai * bi));
}

export function addMatrix(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((v, j) => v + B[i][j]));
}

export function scaleMatrix(M: number[][], s: number): number[][] {
  return M.map((row) => row.map((v) => v * s));
}

export function goodness(h: number[]): number {
  return h.reduce((s, x) => s + x * x, 0);
}
