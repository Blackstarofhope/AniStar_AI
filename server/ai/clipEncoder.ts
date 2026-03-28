import * as ort from "onnxruntime-node";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import * as zlib from "zlib";

export const CLIP_DIM = 512;
export const CONTEXT_LENGTH = 77;
const SOT_TOKEN = 49406;
const EOT_TOKEN = 49407;

const MODELS_DIR = path.join(process.cwd(), "models");

const MODEL_URLS = {
  visual:
    "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_fp32.onnx",
  text:
    "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model_fp32.onnx",
  vocab:
    "https://raw.githubusercontent.com/openai/CLIP/main/clip/bpe_simple_vocab_16e6.txt.gz",
};

const MODEL_PATHS = {
  visual: path.join(MODELS_DIR, "clip-vit-b32-visual.onnx"),
  text: path.join(MODELS_DIR, "clip-vit-b32-text.onnx"),
  vocab: path.join(MODELS_DIR, "bpe_vocab.txt"),
};

// ---- Normalisation constants (CLIP standard) ----
const IMG_MEAN = [0.48145466, 0.4578275, 0.40821073];
const IMG_STD = [0.26862954, 0.26130258, 0.27577711];
const IMG_SIZE = 224;

// ---- Download utility ----
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    function get(u: string, redirects = 0) {
      if (redirects > 10) return reject(new Error("Too many redirects"));
      const proto = u.startsWith("https") ? https : http;
      proto
        .get(u, { headers: { "User-Agent": "onnx-downloader/1.0" } }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
            return get(res.headers.location as string, redirects + 1);
          }
          if (res.statusCode !== 200) {
            file.close();
            fs.unlink(destPath, () => {});
            return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          }
          res.pipe(file);
          file.on("finish", () => file.close(() => resolve()));
          file.on("error", (err) => {
            fs.unlink(destPath, () => {});
            reject(err);
          });
        })
        .on("error", (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
    }
    get(url);
  });
}

async function ensureModel(key: keyof typeof MODEL_URLS): Promise<void> {
  const destPath = MODEL_PATHS[key];
  if (fs.existsSync(destPath)) return;
  console.log(`[CLIP] Downloading ${key} model…`);
  const tmpPath = destPath + ".tmp";
  await downloadFile(MODEL_URLS[key], tmpPath);
  fs.renameSync(tmpPath, destPath);
  console.log(`[CLIP] ${key} model ready.`);
}

// ---- CLIP BPE Tokenizer (mirrors openai/CLIP Python implementation) ----

function buildByteEncoder(): Map<number, string> {
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n++);
    }
  }
  const m = new Map<number, string>();
  bs.forEach((b, i) => m.set(b, String.fromCharCode(cs[i])));
  return m;
}

function getPairs(word: string[]): Set<string> {
  const pairs = new Set<string>();
  for (let i = 0; i < word.length - 1; i++) {
    pairs.add(`${word[i]}\x00${word[i + 1]}`);
  }
  return pairs;
}

class CLIPTokenizer {
  private encoder: Map<string, number> = new Map();
  private bpeRanks: Map<string, number> = new Map();
  private byteEncoder: Map<number, string>;
  private bpeCache: Map<string, string[]> = new Map();
  private pat: RegExp;

  constructor(vocabText: string) {
    this.byteEncoder = buildByteEncoder();

    const lines = vocabText.split("\n");
    let mergeLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("#")) continue;
      if (line.trim() === "") continue;
      mergeLines.push(line.trim());
    }

    this.pat = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/giu;

    const vocab: string[] = [];
    const byteDecoder = new Map<string, number>();
    this.byteEncoder.forEach((v, k) => byteDecoder.set(v, k));

    for (let i = 0; i < 256; i++) {
      const ch = this.byteEncoder.get(i)!;
      vocab.push(ch);
    }
    for (const merge of mergeLines) {
      vocab.push(merge.replace(" ", ""));
    }
    vocab.push("<|startoftext|>");
    vocab.push("<|endoftext|>");

    vocab.forEach((v, i) => this.encoder.set(v, i));

    mergeLines.forEach((merge, rank) => {
      const parts = merge.split(" ");
      this.bpeRanks.set(`${parts[0]}\x00${parts[1]}`, rank);
    });
  }

  private bpe(token: string): string[] {
    if (this.bpeCache.has(token)) return this.bpeCache.get(token)!;

    let word: string[] = [...token].map((c, i) =>
      i === token.length - 1 ? c + "</w>" : c
    );

    let pairs = getPairs(word);
    if (pairs.size === 0) {
      this.bpeCache.set(token, word);
      return word;
    }

    while (true) {
      let bestRank = Infinity;
      let bigram: string | null = null;
      for (const pair of pairs) {
        const rank = this.bpeRanks.get(pair) ?? Infinity;
        if (rank < bestRank) {
          bestRank = rank;
          bigram = pair;
        }
      }
      if (bigram === null || !this.bpeRanks.has(bigram)) break;

      const [first, second] = bigram.split("\x00");
      const newWord: string[] = [];
      let i = 0;
      while (i < word.length) {
        const j = word.indexOf(first, i);
        if (j === -1) {
          newWord.push(...word.slice(i));
          break;
        }
        newWord.push(...word.slice(i, j));
        i = j;
        if (word[i] === first && i < word.length - 1 && word[i + 1] === second) {
          newWord.push(first + second);
          i += 2;
        } else {
          newWord.push(word[i]);
          i++;
        }
      }
      word = newWord;
      if (word.length === 1) break;
      pairs = getPairs(word);
    }

    this.bpeCache.set(token, word);
    return word;
  }

  encode(text: string): number[] {
    const bpeTokens: number[] = [SOT_TOKEN];

    const clean = text.toLowerCase().trim();
    const matches = clean.match(this.pat) ?? [];

    for (const token of matches) {
      const encoded = Array.from(new TextEncoder().encode(token))
        .map((b) => this.byteEncoder.get(b)!)
        .join("");
      for (const bpeToken of this.bpe(encoded)) {
        bpeTokens.push(this.encoder.get(bpeToken) ?? 0);
      }
    }

    bpeTokens.push(EOT_TOKEN);

    if (bpeTokens.length > CONTEXT_LENGTH) {
      bpeTokens.length = CONTEXT_LENGTH - 1;
      bpeTokens.push(EOT_TOKEN);
    }

    while (bpeTokens.length < CONTEXT_LENGTH) bpeTokens.push(0);
    return bpeTokens;
  }
}

// ---- Image preprocessing ----

async function preprocessImage(imageBuffer: Buffer): Promise<Float32Array> {
  let Jimp: typeof import("jimp-compact");
  try {
    const mod = await import("jimp-compact" as string);
    Jimp = (mod.default ?? mod) as typeof import("jimp-compact");
  } catch {
    throw new Error("[CLIP] jimp-compact not available for image preprocessing");
  }

  const img = await (Jimp as any).read(imageBuffer);
  const w: number = img.getWidth();
  const h: number = img.getHeight();
  const shorter = Math.min(w, h);
  const scale = IMG_SIZE / shorter;
  const newW = Math.round(w * scale);
  const newH = Math.round(h * scale);
  img.resize(newW, newH);

  const x0 = Math.floor((newW - IMG_SIZE) / 2);
  const y0 = Math.floor((newH - IMG_SIZE) / 2);
  img.crop(x0, y0, IMG_SIZE, IMG_SIZE);

  const pixels = new Float32Array(3 * IMG_SIZE * IMG_SIZE);
  for (let y = 0; y < IMG_SIZE; y++) {
    for (let x = 0; x < IMG_SIZE; x++) {
      const { r, g, b } = Jimp.intToRGBA(img.getPixelColor(x, y));
      const i = y * IMG_SIZE + x;
      pixels[0 * IMG_SIZE * IMG_SIZE + i] = (r / 255 - IMG_MEAN[0]) / IMG_STD[0];
      pixels[1 * IMG_SIZE * IMG_SIZE + i] = (g / 255 - IMG_MEAN[1]) / IMG_STD[1];
      pixels[2 * IMG_SIZE * IMG_SIZE + i] = (b / 255 - IMG_MEAN[2]) / IMG_STD[2];
    }
  }
  return pixels;
}

// ---- Session state ----

let visualSession: ort.InferenceSession | null = null;
let textSession: ort.InferenceSession | null = null;
let tokenizer: CLIPTokenizer | null = null;
let loadPromise: Promise<void> | null = null;

export async function loadCLIP(): Promise<void> {
  if (visualSession && textSession && tokenizer) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    fs.mkdirSync(MODELS_DIR, { recursive: true });

    await ensureModel("vocab");
    let vocabRaw = fs.readFileSync(MODEL_PATHS.vocab, "utf8");
    if (vocabRaw.charCodeAt(0) === 0x1f && vocabRaw.charCodeAt(1) === 0x8b) {
      const buf = fs.readFileSync(MODEL_PATHS.vocab);
      vocabRaw = zlib.gunzipSync(buf).toString("utf8");
      fs.writeFileSync(MODEL_PATHS.vocab, vocabRaw, "utf8");
    }
    tokenizer = new CLIPTokenizer(vocabRaw);
    console.log("[CLIP] Tokenizer ready.");

    await ensureModel("visual");
    visualSession = await ort.InferenceSession.create(MODEL_PATHS.visual, {
      executionProviders: ["cpu"],
    });
    console.log("[CLIP] Visual encoder loaded.");

    await ensureModel("text");
    textSession = await ort.InferenceSession.create(MODEL_PATHS.text, {
      executionProviders: ["cpu"],
    });
    console.log("[CLIP] Text encoder loaded.");
  })();

  return loadPromise;
}

// ---- Public API ----

export async function encodeTexts(texts: string[]): Promise<Float32Array[]> {
  await loadCLIP();

  const batchSize = texts.length;
  const inputIds = new BigInt64Array(batchSize * CONTEXT_LENGTH);
  const attentionMask = new BigInt64Array(batchSize * CONTEXT_LENGTH);

  texts.forEach((text, b) => {
    const tokens = tokenizer!.encode(text);
    let eotSeen = false;
    tokens.forEach((id, i) => {
      inputIds[b * CONTEXT_LENGTH + i] = BigInt(id);
      if (!eotSeen) attentionMask[b * CONTEXT_LENGTH + i] = 1n;
      if (id === EOT_TOKEN) eotSeen = true;
    });
  });

  const feeds: Record<string, ort.Tensor> = {
    input_ids: new ort.Tensor("int64", inputIds, [batchSize, CONTEXT_LENGTH]),
    attention_mask: new ort.Tensor("int64", attentionMask, [batchSize, CONTEXT_LENGTH]),
  };

  const results = await textSession!.run(feeds);
  const outputKey = Object.keys(results).find((k) =>
    k.includes("embed") || k.includes("pooler") || k === "last_hidden_state"
  ) ?? Object.keys(results)[0];

  const raw = results[outputKey].data as Float32Array;
  const out: Float32Array[] = [];
  const stride = raw.length / batchSize;
  for (let b = 0; b < batchSize; b++) {
    out.push(raw.slice(b * stride, (b + 1) * stride) as Float32Array);
  }
  return out;
}

export async function encodeText(text: string): Promise<Float32Array> {
  return (await encodeTexts([text]))[0];
}

export async function encodeImageBuffer(imageBuffer: Buffer): Promise<Float32Array> {
  await loadCLIP();

  const pixels = await preprocessImage(imageBuffer);
  const tensor = new ort.Tensor("float32", pixels, [1, 3, IMG_SIZE, IMG_SIZE]);
  const feeds: Record<string, ort.Tensor> = { pixel_values: tensor };

  const results = await visualSession!.run(feeds);
  const outputKey = Object.keys(results).find((k) =>
    k.includes("embed") || k.includes("pooler") || k === "last_hidden_state"
  ) ?? Object.keys(results)[0];

  return results[outputKey].data as Float32Array;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function isLoaded(): boolean {
  return visualSession !== null && textSession !== null && tokenizer !== null;
}
