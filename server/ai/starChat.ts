import * as https from "https";
import { storage } from "../storage.js";
import { getAllCurrentAnime, searchAndAddAnime, type AnimeScheduleItem } from "./animeData.js";
import { generateVibeProfile } from "./vibeProfiler.js";
import {
  extractChatSignals, generateStarResponse, filterByGenres,
  STAR_NAME, STAR_BIO, type ChatSignals,
} from "./starPersonality.js";
import { processFeedback, getTopAnimeByGenres, addAnimeEmbeddings } from "./recommendEngine.js";
import { embedAnimeWithFallback, type AnimeInfo } from "./textEmbedder.js";
import {
  isStarLearningReady,
  embedChatTextWithFallback,
  selectResponseFromEmb,
  recordInteraction,
  recordInteractionByCategory,
  STAR_CONFIDENCE_THRESHOLD,
  type SelectionResult,
} from "./starLearning.js";

export interface ChatMessage {
  role: "user" | "star";
  content: string;
}

export interface ChatResponse {
  response: string;
  implicitFeedback: boolean;
  /**
   * Pool entry id that the learning system selected (e.g. "genre:Action").
   * Clients may echo this back to POST /api/ai/chat/feedback for explicit
   * thumbs-up / thumbs-down training.
   */
  learningCategory?: string;
}

export { STAR_NAME, STAR_BIO };

// ---------------------------------------------------------------------------
// Gemini API integration
// ---------------------------------------------------------------------------

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
        "x-goog-api-key": apiKey,
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`Gemini HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        } else {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(new Error("Gemini request timed out")); });
    req.write(payload);
    req.end();
  });
}

const titleExtractionCache = new Map<string, string | null>();
const TITLE_CACHE_MAX = 500;

async function extractTitleViaGemini(message: string): Promise<string | null> {
  const quoted = message.match(/["']([A-Za-z0-9][^"']{2,60})["']/);
  if (quoted) return quoted[1].trim();

  if (titleExtractionCache.has(message)) return titleExtractionCache.get(message) ?? null;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const body = {
    system_instruction: {
      parts: [{ text: "Extract the anime title from the user's message. Respond with ONLY the anime title, nothing else. If there is no anime title mentioned, respond with exactly: NONE" }],
    },
    contents: [{ role: "user", parts: [{ text: message }] }],
    generationConfig: {
      maxOutputTokens: 30,
      temperature: 0,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  try {
    const raw = await httpsPost(GEMINI_ENDPOINT, apiKey, body);
    const parsed = JSON.parse(raw);
    const parts: { text?: string; thought?: boolean }[] =
      parsed?.candidates?.[0]?.content?.parts ?? [];
    const responsePart = parts.find((p) => !p.thought && p.text && p.text.trim().length > 0);
    const text = responsePart?.text?.trim();
    const result = text && text !== "NONE" ? text : null;

    if (titleExtractionCache.size >= TITLE_CACHE_MAX) {
      titleExtractionCache.delete(titleExtractionCache.keys().next().value!);
    }
    titleExtractionCache.set(message, result);
    return result;
  } catch {
    titleExtractionCache.set(message, null);
    return null;
  }
}

async function callGemini(
  userMessage: string,
  history: ChatMessage[],
  searchContext?: string
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const systemPrompt =
    `You are ${STAR_NAME}, an AI anime guide. ${STAR_BIO} ` +
    `Respond in character as Star — warm, poetic, knowledgeable. ` +
    `You have deep knowledge of all anime, not just currently airing shows. ` +
    `When the user mentions a specific anime, discuss it knowledgeably and suggest similar titles. ` +
    `When they ask for recommendations, ask about their preferences first or suggest based on conversation context. ` +
    `Keep responses conversational and under 150 words.` +
    (searchContext ? `\n${searchContext}` : "");

  const contents = [
    ...history.slice(-6).map((m) => ({
      role: m.role === "star" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      maxOutputTokens: 220,
      temperature: 0.9,
      topP: 0.95,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  try {
    const raw = await httpsPost(GEMINI_ENDPOINT, apiKey, body);
    const parsed = JSON.parse(raw);
    const parts: { text?: string; thought?: boolean }[] =
      parsed?.candidates?.[0]?.content?.parts ?? [];
    const responsePart = parts.find((p) => !p.thought && p.text && p.text.trim().length > 0);
    const text = responsePart?.text;
    if (text && text.trim().length > 0) {
      return text.trim();
    }
    return null;
  } catch (e) {
    console.warn("[Star] Gemini API error:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function processChat(
  message: string,
  history: ChatMessage[],
  userId = "default"
): Promise<ChatResponse> {
  const catalog = await getAllCurrentAnime();
  const catalogTitles = catalog.map((a) => a.title);

  const signals = extractChatSignals(message, catalogTitles);

  const hasKeywordSignals =
    signals.likedGenres.length > 0 ||
    signals.dislikedGenres.length > 0 ||
    signals.moodGenres.length > 0;

  // ------------------------------------------------------------------
  // Learning system integration
  // ------------------------------------------------------------------
  let learningCategory: string | undefined;

  if (isStarLearningReady()) {
    const inputEmb = await embedChatTextWithFallback(message);

    if (hasKeywordSignals) {
      // Keyword signals are reliable ground truth → reinforce them in the FF
      // network immediately (runs synchronously, very fast).
      for (const genre of signals.likedGenres) {
        recordInteractionByCategory(inputEmb, `genre:${genre}`, true, 0.5);
      }
      for (const genre of signals.dislikedGenres) {
        recordInteractionByCategory(inputEmb, `genre:${genre}`, false, 0.4);
      }
      for (const genre of signals.moodGenres) {
        recordInteractionByCategory(inputEmb, `genre:${genre}`, true, 0.35);
      }
    } else {
      // No keyword match — ask the FF network if it has a confident guess
      // and use that guess to augment the signals so Star gives a targeted
      // response rather than a generic one.
      const learningResult: SelectionResult | null = selectResponseFromEmb(inputEmb);

      if (learningResult && learningResult.goodness >= STAR_CONFIDENCE_THRESHOLD) {
        const cat = learningResult.entry.category;
        learningCategory = learningResult.entry.id;

        if (cat.startsWith("genre:")) {
          const genre = cat.slice(6);
          if (!signals.likedGenres.includes(genre)) {
            signals.likedGenres.push(genre);
          }
        } else if (cat.startsWith("mood:")) {
          const mood = cat.slice(5);
          if (!signals.moodGenres.includes(mood)) {
            signals.moodGenres.push(mood);
          }
        }

        // Mild positive: the user is engaging, which is a weak positive signal.
        const continuingConversation = history.length > 0;
        recordInteraction(
          inputEmb,
          learningResult.entry.embedding,
          continuingConversation,
          0.3
        );
      }
    }
  }
  // ------------------------------------------------------------------

  const allGenres = [...signals.likedGenres, ...signals.moodGenres];

  let matches: AnimeInfo[] = [];
  let noMatchFallbacks: AnimeInfo[] = [];

  if (allGenres.length > 0) {
    matches = filterByGenres(catalog as AnimeInfo[], allGenres, 3);
  }

  if (signals.isAskingRec || matches.length === 0) {
    noMatchFallbacks = getTopAnimeByGenres(catalog as AnimeInfo[], [], 3);
  }

  const historyLength = history.length;

  let searchContext: string | undefined;
  if (signals.mentionedTitles.length === 0) {
    const potentialTitle = await extractTitleViaGemini(message);
    if (potentialTitle) {
      const searchResults = await searchAndAddAnime(potentialTitle);
      if (searchResults.length > 0) {
        const entries: { animeId: number; embedding: number[] }[] = [];
        for (const anime of searchResults) {
          try {
            const embedding = await embedAnimeWithFallback(anime as AnimeInfo);
            entries.push({ animeId: anime.mal_id, embedding });
          } catch {
            // skip
          }
        }
        if (entries.length > 0) {
          await addAnimeEmbeddings(userId, entries);
        }
        // Record discovery attribution for each new anime (fire-and-forget).
        const displayName = await storage.getDisplayName(userId).catch(() => null) ?? userId;
        for (const a of searchResults) {
          storage.recordDiscovery(a.mal_id, userId, displayName).catch(() => {});
        }

        const titles: string[] = [];
        const attributionLines: string[] = [];
        for (let i = 0; i < searchResults.length; i++) {
          const a = searchResults[i];
          const genres = (a.genres ?? []).map((g) => g.name).join(", ");
          let entry = `${a.title}${genres ? ` (${genres})` : ""}`;
          if (i < 2) {
            try {
              const vibe = await generateVibeProfile(
                a.mal_id,
                a.title,
                (a.genres ?? []).map((g) => g.name),
                a.synopsis ?? "",
                a.score ?? 0
              );
              if (vibe) {
                entry += `. Vibe: ${vibe.atmosphere}, ${vibe.pacing}, ${vibe.tone}`;
              }
            } catch {
              // skip vibe on error
            }
          }
          titles.push(entry);

          // Check if this anime was previously discovered by a different user.
          try {
            const discovery = await storage.getDiscovery(a.mal_id);
            if (discovery && discovery.userId !== userId) {
              attributionLines.push(
                `${a.title} was discovered for our community by ${discovery.displayName}.`
              );
            }
          } catch {
            // attribution is best-effort
          }
        }
        searchContext = `The user appears to be asking about: ${titles.join("; ")}. These have been added to the recommendation system.`;
        if (attributionLines.length > 0) {
          searchContext += ` ${attributionLines.join(" ")}`;
        }
      }
    }
  }

  const geminiResponse = await callGemini(message, history, searchContext);
  const response = geminiResponse ?? generateStarResponse(signals, matches, noMatchFallbacks, historyLength);

  const implicitFeedback =
    signals.likedGenres.length > 0 ||
    signals.dislikedGenres.length > 0 ||
    signals.moodGenres.length > 0;

  if (implicitFeedback) {
    setImmediate(() => {
      applyImplicitFeedback(signals, catalog).catch(() => {});
    });
  }

  return { response, implicitFeedback, learningCategory };
}

async function applyImplicitFeedback(
  signals: ChatSignals,
  catalog: AnimeScheduleItem[]
): Promise<void> {
  const POSITIVE_RATING = 0.65;
  const MOOD_RATING = 0.58;
  const NEGATIVE_RATING = 0.35;

  if (signals.likedGenres.length > 0) {
    const matches = filterByGenres(catalog as AnimeInfo[], signals.likedGenres, 2);
    for (const anime of matches) {
      try {
        await processFeedback(anime.mal_id, POSITIVE_RATING);
      } catch {
      }
    }
  }

  if (signals.dislikedGenres.length > 0) {
    const matches = filterByGenres(catalog as AnimeInfo[], signals.dislikedGenres, 2);
    for (const anime of matches) {
      try {
        await processFeedback(anime.mal_id, NEGATIVE_RATING);
      } catch {
      }
    }
  }

  if (signals.moodGenres.length > 0) {
    const moodOnly = signals.moodGenres.filter((g) => !signals.likedGenres.includes(g));
    const matches = filterByGenres(catalog as AnimeInfo[], moodOnly, 2);
    for (const anime of matches) {
      try {
        await processFeedback(anime.mal_id, MOOD_RATING);
      } catch {
      }
    }
  }
}
