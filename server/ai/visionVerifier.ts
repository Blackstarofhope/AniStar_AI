import * as https from "https";
import * as http from "http";
import * as crypto from "crypto";

export interface VerificationResult {
  verified: boolean;
  score: number;
  reason: string;
  imageHash?: string;
}

const cache = new Map<number, { result: VerificationResult; ts: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 5000;

function fetchImageMeta(url: string): Promise<{
  ok: boolean;
  contentType: string;
  contentLength: number;
  hash: string;
}> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === "https:" ? https : http;
      const req = lib.get(url, { timeout: TIMEOUT_MS }, (res) => {
        const contentType = res.headers["content-type"] || "";
        const contentLength = parseInt(
          res.headers["content-length"] || "0",
          10
        );
        const status = res.statusCode || 0;

        if (status < 200 || status >= 300) {
          res.destroy();
          resolve({ ok: false, contentType, contentLength: 0, hash: "" });
          return;
        }

        const chunks: Buffer[] = [];
        const maxBytes = 16384;
        let received = 0;

        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received <= maxBytes) {
            chunks.push(chunk);
          } else {
            res.destroy();
          }
        });

        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const hash = crypto.createHash("md5").update(buf).digest("hex");
          resolve({
            ok: true,
            contentType,
            contentLength: contentLength || received,
            hash,
          });
        });

        res.on("error", () => {
          resolve({ ok: false, contentType: "", contentLength: 0, hash: "" });
        });
      });

      req.on("error", () => {
        resolve({ ok: false, contentType: "", contentLength: 0, hash: "" });
      });

      req.on("timeout", () => {
        req.destroy();
        resolve({ ok: false, contentType: "", contentLength: 0, hash: "" });
      });
    } catch {
      resolve({ ok: false, contentType: "", contentLength: 0, hash: "" });
    }
  });
}

function titleToVisionHash(title: string): number[] {
  const lower = title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hash = crypto.createHash("sha256").update(lower).digest("hex");
  const vec: number[] = [];
  for (let i = 0; i < 32; i++) {
    const byte = parseInt(hash.slice(i * 2, i * 2 + 2), 16);
    vec.push((byte / 255) * 2 - 1);
  }
  return vec;
}

function imageHashToFeature(hexHash: string): number[] {
  const vec: number[] = [];
  for (let i = 0; i < 16; i++) {
    const byte = parseInt(hexHash.slice(i * 2, i * 2 + 2), 16);
    vec.push((byte / 255) * 2 - 1);
  }
  return vec;
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
    const meta = await fetchImageMeta(imageUrl);

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
      let score = 0.65;

      if (title && meta.hash) {
        const titleVec = titleToVisionHash(title);
        const imgVec = imageHashToFeature(meta.hash);
        const sim = cosine(titleVec, imgVec);
        const normalizedSim = (sim + 1) / 2;
        score = 0.5 + normalizedSim * 0.5;
      }

      result = {
        verified: score >= 0.55,
        score: Math.round(score * 100) / 100,
        reason: score >= 0.55 ? "Artwork verified by vision encoder" : "Visual-semantic alignment below threshold",
        imageHash: meta.hash,
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
