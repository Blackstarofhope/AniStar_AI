import * as https from "https";
import { storage } from "../storage.js";

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const CLAUDE_ENDPOINT = "https://api.anthropic.com/v1/messages";

const CACHE_MAX = 500;
const RATE_LIMIT_MS = 500;

export interface VibeProfile {
  atmosphere: string;
  pacing: string;
  tone: string;
  protagonistArchetype: string;
  relationshipDynamics: string;
  emotionalArc: string;
  vibeText: string;
}

// ---------------------------------------------------------------------------
// In-memory cache + lazy DB load
// ---------------------------------------------------------------------------

const vibeCache = new Map<number, VibeProfile>();
let dbLoadPromise: Promise<void> | null = null;
let lastLLMCallTime = 0;

function ensureDbLoaded(): Promise<void> {
  if (!dbLoadPromise) {
    dbLoadPromise = storage.getAllVibeProfiles().then((rows) => {
      for (const { malId, profile } of rows) {
        vibeCache.set(malId, profile as VibeProfile);
      }
      console.log(`[VibeProfiler] Loaded ${vibeCache.size} cached profiles from DB.`);
    }).catch((e) => {
      console.warn("[VibeProfiler] Failed to load profiles from DB:", e instanceof Error ? e.message : e);
      dbLoadPromise = null;
    });
  }
  return dbLoadPromise;
}

function evictIfNeeded(): void {
  while (vibeCache.size >= CACHE_MAX) {
    vibeCache.delete(vibeCache.keys().next().value!);
  }
}

// ---------------------------------------------------------------------------
// HTTPS helper
// ---------------------------------------------------------------------------

function httpsPost(url: string, apiKey: string, body: object): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`Claude HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        } else {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(12000, () => { req.destroy(new Error("Claude vibe request timed out")); });
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function generateVibeProfile(
  malId: number,
  title: string,
  genres: string[],
  synopsis: string,
  score: number
): Promise<VibeProfile | null> {
  await ensureDbLoaded();

  if (vibeCache.has(malId)) return vibeCache.get(malId)!;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const now = Date.now();
  const elapsed = now - lastLLMCallTime;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
  }
  lastLLMCallTime = Date.now();

  const synopsisSnippet = synopsis.slice(0, 300);
  const genresStr = genres.join(", ") || "Unknown";
  const userMessage = `Anime: ${title}. Genres: ${genresStr}. Score: ${score}/10. Synopsis: ${synopsisSnippet}`;

  const systemPrompt =
    "You are an anime analyst. Given an anime's details, generate a JSON object describing its vibe profile. " +
    "Respond with ONLY valid JSON, no markdown backticks. " +
    "The JSON must have these exact keys: " +
    "atmosphere (the visual/emotional setting feel in 5-10 words), " +
    "pacing (the narrative rhythm in 5-10 words), " +
    "tone (the overall emotional tone in 5-10 words), " +
    "protagonistArchetype (the main character type in 5-10 words), " +
    "relationshipDynamics (how characters relate to each other in 5-10 words), " +
    "emotionalArc (the overarching emotional journey in 5-10 words).";

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  };

  try {
    const raw = await httpsPost(CLAUDE_ENDPOINT, apiKey, body);
    const parsed = JSON.parse(raw);
    const text = (parsed?.content?.[0]?.text as string | undefined)?.trim();
    if (!text) return null;

    const jsonText = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim();
    const json = JSON.parse(jsonText) as Record<string, string>;

    const atmosphere = String(json.atmosphere ?? "");
    const pacing = String(json.pacing ?? "");
    const tone = String(json.tone ?? "");
    const protagonistArchetype = String(json.protagonistArchetype ?? "");
    const relationshipDynamics = String(json.relationshipDynamics ?? "");
    const emotionalArc = String(json.emotionalArc ?? "");

    if (!atmosphere || !pacing || !tone || !protagonistArchetype || !relationshipDynamics || !emotionalArc) {
      return null;
    }

    const vibeText =
      `${title} has a ${atmosphere} atmosphere with ${pacing} pacing. ` +
      `The tone is ${tone}, driven by a ${protagonistArchetype}. ` +
      `Relationships are defined by ${relationshipDynamics}, and the emotional arc follows ${emotionalArc}.`;

    const profile: VibeProfile = {
      atmosphere,
      pacing,
      tone,
      protagonistArchetype,
      relationshipDynamics,
      emotionalArc,
      vibeText,
    };

    evictIfNeeded();
    vibeCache.set(malId, profile);

    storage.saveVibeProfile(malId, profile).catch((e) => {
      console.warn("[VibeProfiler] Failed to persist profile to DB:", e instanceof Error ? e.message : e);
    });

    return profile;
  } catch (e) {
    console.warn("[VibeProfiler] Failed to generate profile for", title, ":", e instanceof Error ? e.message : e);
    return null;
  }
}

export function getVibeProfileFromCache(malId: number): VibeProfile | null {
  return vibeCache.get(malId) ?? null;
}
