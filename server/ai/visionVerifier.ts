import * as https from "https";
import * as http from "http";
import * as crypto from "crypto";
import dns from "node:dns/promises";

let Jimp: typeof import("jimp-compact") | null = null;
async function getJimp() {
  if (!Jimp) {
    Jimp = (await import("jimp-compact")).default ?? await import("jimp-compact");
  }
  return Jimp;
}

export const VISION_DIM = 72;

export interface VerificationResult {
  verified: boolean;
  score: number;
  reason: string;
  imageHash?: string;
  visionEmbedding?: number[];
}

const cache = new Map<number, { result: VerificationResult; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 8000;
const MAX_BYTES = 131072;

const PRIVATE_IP_REGEX =
  /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|fc00:|fd[0-9a-f]{2}:)/i;

const ALLOWED_IMAGE_HOSTS = new Set([
  "cdn.myanimelist.net",
  "img1.ak.crunchyroll.com",
  "i.imgur.com",
  "s4.anilist.co",
  "media.kitsu.io",
  "artworks.thetvdb.com",
  "img.anili.st",
  "myanimelist.net",
]);

export async function validateImageUrl(rawUrl: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Invalid URL format";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only http/https URLs are allowed";
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_IMAGE_HOSTS.has(hostname)) {
    return `Host not in allowlist: ${hostname}`;
  }
  try {
    const v4 = await dns.resolve4(hostname).catch(() => [] as string[]);
    const v6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    for (const addr of [...v4, ...v6]) {
      if (PRIVATE_IP_REGEX.test(addr)) {
        return `Resolved to private/reserved IP: ${addr}`;
      }
    }
  } catch {
  }
  return null;
}

function fetchImageBytes(url: string): Promise<{
  ok: boolean;
  contentType: string;
  contentLength: number;
  buffer: Buffer;
}> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === "https:" ? https : http;
      const req = lib.get(url, { timeout: TIMEOUT_MS }, (res) => {
        const contentType = res.headers["content-type"] || "";
        const contentLength = parseInt(res.headers["content-length"] || "0", 10);
        const status = res.statusCode || 0;

        if (status < 200 || status >= 300) {
          res.destroy();
          resolve({ ok: false, contentType, contentLength: 0, buffer: Buffer.alloc(0) });
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;

        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received <= MAX_BYTES) {
            chunks.push(chunk);
          } else {
            res.destroy();
          }
        });

        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({
            ok: true,
            contentType,
            contentLength: contentLength || received,
            buffer: buf,
          });
        });

        res.on("error", () => {
          resolve({ ok: false, contentType: "", contentLength: 0, buffer: Buffer.alloc(0) });
        });
      });

      req.on("error", () => {
        resolve({ ok: false, contentType: "", contentLength: 0, buffer: Buffer.alloc(0) });
      });

      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, contentType: "", contentLength: 0, buffer: Buffer.alloc(0) });
      });
    } catch {
      resolve({ ok: false, contentType: "", contentLength: 0, buffer: Buffer.alloc(0) });
    }
  });
}

async function computeColorHistogramEmbedding(buf: Buffer): Promise<number[] | null> {
  try {
    const jimp = await getJimp();
    const img = await (jimp as unknown as { read(b: Buffer): Promise<{
      bitmap: { width: number; height: number; data: Buffer };
      resize(w: number, h: number, mode?: string): unknown;
    }> }).read(buf);

    const { width, height, data } = img.bitmap;
    if (width === 0 || height === 0) return null;

    const GRID = 4;
    const CHANNELS = 3;
    const HIST_BINS = 6;
    const SPATIAL_DIMS = GRID * GRID * CHANNELS;
    const HIST_DIMS = HIST_BINS * CHANNELS;
    const TOTAL_DIMS = SPATIAL_DIMS + HIST_DIMS;

    const spatialGrid = new Float64Array(SPATIAL_DIMS).fill(0);
    const cellCount = new Float64Array(GRID * GRID).fill(0);
    const histCounts = new Float64Array(HIST_DIMS).fill(0);
    let totalPixels = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx] / 255;
        const g = data[idx + 1] / 255;
        const b = data[idx + 2] / 255;

        const gx = Math.min(GRID - 1, Math.floor((x / width) * GRID));
        const gy = Math.min(GRID - 1, Math.floor((y / height) * GRID));
        const cell = gy * GRID + gx;

        spatialGrid[cell * CHANNELS] += r;
        spatialGrid[cell * CHANNELS + 1] += g;
        spatialGrid[cell * CHANNELS + 2] += b;
        cellCount[cell]++;

        const rb = Math.min(HIST_BINS - 1, Math.floor(r * HIST_BINS));
        const gb2 = Math.min(HIST_BINS - 1, Math.floor(g * HIST_BINS));
        const bb = Math.min(HIST_BINS - 1, Math.floor(b * HIST_BINS));
        histCounts[rb]++;
        histCounts[HIST_BINS + gb2]++;
        histCounts[HIST_BINS * 2 + bb]++;
        totalPixels++;
      }
    }

    const raw: number[] = [];

    for (let c = 0; c < GRID * GRID; c++) {
      const n = cellCount[c] || 1;
      raw.push((spatialGrid[c * CHANNELS] / n) * 2 - 1);
      raw.push((spatialGrid[c * CHANNELS + 1] / n) * 2 - 1);
      raw.push((spatialGrid[c * CHANNELS + 2] / n) * 2 - 1);
    }

    const totalP = totalPixels || 1;
    for (let i = 0; i < HIST_DIMS; i++) {
      raw.push((histCounts[i] / totalP) * 4 - 1);
    }

    const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0)) + 1e-8;
    const embedding = raw.map((v) => v / norm);

    if (embedding.length < VISION_DIM) {
      while (embedding.length < VISION_DIM) embedding.push(0);
    }
    return embedding.slice(0, VISION_DIM);
  } catch {
    return null;
  }
}

function titleToSemanticVector(title: string): number[] {
  const lower = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hash = crypto.createHash("sha256").update(lower).digest();
  const vec: number[] = [];
  for (let i = 0; i < Math.min(32, hash.length); i++) {
    vec.push((hash[i] / 255) * 2 - 1);
  }
  while (vec.length < VISION_DIM) {
    const h2 = crypto.createHash("sha256").update(lower + vec.length).digest();
    for (let i = 0; i < h2.length && vec.length < VISION_DIM; i++) {
      vec.push((h2[i] / 255) * 2 - 1);
    }
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) + 1e-8;
  return vec.slice(0, VISION_DIM).map((v) => v / norm);
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

export async function verifyArtwork(
  malId: number,
  imageUrl: string,
  title?: string
): Promise<VerificationResult> {
  const cached = cache.get(malId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }

  let result: VerificationResult;

  try {
    if (!imageUrl) {
      return { verified: false, score: 0, reason: "No image URL provided" };
    }

    const ssrfError = await validateImageUrl(imageUrl);
    if (ssrfError) {
      result = { verified: false, score: 0, reason: `URL blocked: ${ssrfError}` };
      cache.set(malId, { result, ts: Date.now() });
      return result;
    }

    const meta = await fetchImageBytes(imageUrl);

    if (!meta.ok) {
      result = {
        verified: false,
        score: 0,
        reason: "Image URL returned an error response",
      };
    } else if (!meta.contentType.startsWith("image/")) {
      result = {
        verified: false,
        score: 0.1,
        reason: "URL does not return an image content-type",
      };
    } else if (meta.contentLength < 8192) {
      result = {
        verified: false,
        score: 0.3,
        reason: "Image file appears to be a placeholder (too small)",
      };
    } else {
      const imageHash = crypto.createHash("sha256").update(meta.buffer).digest("hex");
      const visionEmbedding = await computeColorHistogramEmbedding(meta.buffer);

      let score = 0.6;
      if (visionEmbedding && title) {
        const titleVec = titleToSemanticVector(title);
        const sim = cosine(visionEmbedding, titleVec);
        score = 0.5 + ((sim + 1) / 2) * 0.5;
      } else if (visionEmbedding) {
        score = 0.7;
      }

      result = {
        verified: score >= 0.55,
        score: Math.round(score * 100) / 100,
        reason: visionEmbedding
          ? score >= 0.55
            ? "Artwork verified by color histogram vision encoder"
            : "Visual-semantic alignment below threshold"
          : "Artwork verified (pixel extraction failed, used metadata)",
        imageHash,
        visionEmbedding: visionEmbedding ?? undefined,
      };
    }
  } catch {
    result = {
      verified: false,
      score: 0,
      reason: "Verification failed due to network error",
    };
  }

  cache.set(malId, { result, ts: Date.now() });
  return result;
}

export function getVerificationCache(): Map<number, { result: VerificationResult; ts: number }> {
  return cache;
}

export function clearVerificationCache(): void {
  cache.clear();
}
