import * as https from "https";
import * as http from "http";
import * as crypto from "crypto";
import dns from "node:dns/promises";
import { encodeImageBuffer, encodeText, cosineSimilarity, isLoaded as clipIsLoaded } from "./clipEncoder.js";

let Jimp: typeof import("jimp-compact") | null = null;
async function getJimp() {
  if (!Jimp) {
    Jimp = (await import("jimp-compact")).default ?? await import("jimp-compact");
  }
  return Jimp;
}

export const VISION_DIM = 512;

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
    if (clipIsLoaded()) {
      const embedding = await encodeImageBuffer(buf);
      return Array.from(embedding);
    }
    return null;
  } catch {
    return null;
  }
}

async function titleToSemanticVector(title: string): Promise<number[]> {
  if (clipIsLoaded()) {
    try {
      const embedding = await encodeText(title);
      return Array.from(embedding);
    } catch {
      return new Array(VISION_DIM).fill(0);
    }
  }
  return new Array(VISION_DIM).fill(0);
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
        const titleVec = await titleToSemanticVector(title);
        const sim = cosineSimilarity(new Float32Array(visionEmbedding), new Float32Array(titleVec));
        score = 0.5 + ((sim + 1) / 2) * 0.5;
      } else if (visionEmbedding) {
        score = 0.7;
      }

      result = {
        verified: score >= 0.55,
        score: Math.round(score * 100) / 100,
        reason: visionEmbedding
          ? score >= 0.55
            ? "Artwork verified by CLIP vision encoder"
            : "Visual-semantic alignment below threshold"
          : "Artwork verified (CLIP not loaded, used metadata)",
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
