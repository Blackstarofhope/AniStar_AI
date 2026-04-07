import * as https from "https";
import { storage } from "../storage.js";
import { getAllCurrentAnime, searchAndAddAnime, type AnimeScheduleItem } from "./animeData.js";
import { generateVibeProfile } from "./vibeProfiler.js";
import {
  extractChatSignals, generateStarResponse, filterByGenres,
  STAR_NAME, STAR_BIO, type ChatSignals,
} from "./starPersonality.js";
import { buildStarSystemPrompt } from "./starPrompt.js";
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
// Pending discovery retry queue
// If recording a discovery to DB fails, we queue it here and retry on the
// next successful chat call, so no discovery is permanently lost.
// ---------------------------------------------------------------------------
interface PendingDiscovery {
  malId: number;
  userId: string;
  displayName: string;
}
const pendingDiscoveries: PendingDiscovery[] = [];

async function flushPendingDiscoveries(): Promise<void> {
  if (pendingDiscoveries.length === 0) return;
  const toRetry = pendingDiscoveries.splice(0, pendingDiscoveries.length);
  for (const entry of toRetry) {
    try {
      await storage.recordDiscovery(entry.malId, entry.userId, entry.displayName);
      console.log(`[Star] Retried discovery record for mal_id=${entry.malId} — OK`);
    } catch (e) {
      console.error(`[Star] Retry of discovery record failed for mal_id=${entry.malId}:`, e instanceof Error ? e.message : e);
      pendingDiscoveries.push(entry);
    }
  }
}

// ---------------------------------------------------------------------------
// Ban detection — parse natural-language ban requests from chat messages
// ---------------------------------------------------------------------------

const BAN_PATTERNS: RegExp[] = [
  /never\s+show\s+me\s+(?:any\s+more\s+|more\s+|any\s+)?(.+?)(?:\s+(?:again|anymore|please))?\s*$/i,
  /i\s+never\s+want\s+to\s+see\s+(.+?)(?:\s+(?:again|anymore|please))?\s*$/i,
  /(?:please\s+)?ban\s+(.+?)\s*$/i,
  /(?:please\s+)?block\s+(.+?)(?:\s+(?:content|shows?|anime))?\s*$/i,
  /i\s+hate\s+(.+?)(?:\s+(?:content|shows?|anime))?\s*$/i,
  /no\s+more\s+(.+?)\s*$/i,
  /remove\s+(.+?)\s+from\s+(?:my\s+)?(?:recommendations?|recs?|feed)\s*$/i,
];

/**
 * Checks whether the user's message contains a ban request, extracts the
 * subject (genre or anime title), persists it via storage.addBan, and
 * returns the display name of what was banned (or null if no ban detected).
 */
async function detectAndApplyBan(
  message: string,
  userId: string,
  catalog: AnimeScheduleItem[]
): Promise<string | null> {
  let extracted: string | null = null;

  for (const pattern of BAN_PATTERNS) {
    const match = message.match(pattern);
    if (match?.[1]) {
      extracted = match[1].trim().toLowerCase();
      break;
    }
  }

  if (!extracted) return null;

  // Strip generic trailing words
  extracted = extracted
    .replace(/\s+(?:anime|shows?|content|stuff|things?|genres?)$/i, "")
    .trim();

  // Guard: ignore if too long (likely a sentence fragment) or too short
  const wordCount = extracted.split(/\s+/).length;
  if (wordCount > 5 || extracted.length < 2) return null;

  // Title-case for display / storage
  const titleCased = extracted
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  // Check against current catalog for an exact or strong partial title match
  const catalogMatch = catalog.find(
    (a) =>
      a.title.toLowerCase() === extracted ||
      (extracted!.length > 5 && a.title.toLowerCase().includes(extracted!))
  );

  try {
    if (catalogMatch) {
      await storage.addBan(userId, {
        malId: catalogMatch.mal_id,
        reason: `Title: ${catalogMatch.title}`,
      });
      return catalogMatch.title;
    } else {
      await storage.addBan(userId, {
        bannedGenre: titleCased,
        reason: "banned via Star chat",
      });
      return titleCased;
    }
  } catch (e) {
    console.warn("[Star] Ban detection: addBan failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Anthropic Claude API integration
// ---------------------------------------------------------------------------

const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const CLAUDE_ENDPOINT = "https://api.anthropic.com/v1/messages";

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
    req.setTimeout(15000, () => { req.destroy(new Error("Claude request timed out")); });
    req.write(payload);
    req.end();
  });
}

const titleExtractionCache = new Map<string, string | null>();
const TITLE_CACHE_MAX = 500;

async function extractTitleViaLLM(message: string): Promise<string | null> {
  const quoted = message.match(/["']([A-Za-z0-9][^"']{2,60})["']/);
  if (quoted) return quoted[1].trim();

  if (titleExtractionCache.has(message)) return titleExtractionCache.get(message) ?? null;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 30,
    system: "Extract the anime title from the user's message. Respond with ONLY the anime title, nothing else. If there is no anime title mentioned, respond with exactly: NONE",
    messages: [{ role: "user", content: message }],
  };

  try {
    const raw = await httpsPost(CLAUDE_ENDPOINT, apiKey, body);
    const parsed = JSON.parse(raw);
    const text = (parsed?.content?.[0]?.text as string | undefined)?.trim();
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

async function callClaude(
  userMessage: string,
  history: ChatMessage[],
  userId: string,
  displayName: string,
  searchContext?: string,
  onboardingHint?: string
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  let systemPrompt = await buildStarSystemPrompt(userId, displayName);
  if (searchContext) systemPrompt += "\n\n## Context for this message\n" + searchContext;
  if (onboardingHint) systemPrompt += "\n\n## Onboarding Guidance\n" + onboardingHint;

  const messages = [
    ...history.slice(-6).map((m) => ({
      role: m.role === "star" ? "assistant" as const : "user" as const,
      content: m.content,
    })),
    { role: "user" as const, content: userMessage },
  ];

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 350,
    system: systemPrompt,
    messages,
  };

  try {
    const raw = await httpsPost(CLAUDE_ENDPOINT, apiKey, body);
    const parsed = JSON.parse(raw);
    const text = (parsed?.content?.[0]?.text as string | undefined)?.trim();
    if (text && text.length > 0) {
      return text;
    }
    return null;
  } catch (e) {
    console.warn("[Star] Claude API error:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function processChat(
  message: string,
  history: ChatMessage[],
  userId = "default"
): Promise<ChatResponse> {
  // Daily message cap — checked before any other processing or Claude call.
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const dayOfWeek = new Date().getDay(); // 0=Sunday … 5=Friday, 6=Saturday
  const dailyCap = dayOfWeek === 5 || dayOfWeek === 6 ? 10 : 5;
  const currentCount = await storage.getChatCount(userId, today);
  if (currentCount >= dailyCap) {
    return {
      response: "You've reached your daily message limit. Star will be ready for you tomorrow.",
      implicitFeedback: false,
    };
  }
  await storage.incrementChatCount(userId, today);

  // Retry any discovery records that failed on a previous call.
  await flushPendingDiscoveries();

  const displayName = await storage.getDisplayName(userId).catch(() => null) ?? userId;

  const catalog = await getAllCurrentAnime();
  const catalogTitles = catalog.map((a) => a.title);

  // Detect ban requests before anything else so the note can be injected into context
  let chatBanNote: string | undefined;
  const bannedViaChat = await detectAndApplyBan(message, userId, catalog);
  if (bannedViaChat) {
    chatBanNote = `User just banned "${bannedViaChat}" via chat. Acknowledge this naturally and warmly — confirm the ban is in effect and pivot toward finding something they will love instead.`;
    console.log(`[Star] Ban added via chat for user=${userId}: "${bannedViaChat}"`);
  }

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
    const potentialTitle = await extractTitleViaLLM(message);
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
        // Record discovery attribution for each new anime.
        for (const a of searchResults) {
          try {
            await storage.recordDiscovery(a.mal_id, userId, displayName);
          } catch (e) {
            console.error(`[Star] recordDiscovery failed for mal_id=${a.mal_id} — queuing for retry:`, e instanceof Error ? e.message : e);
            pendingDiscoveries.push({ malId: a.mal_id, userId, displayName });
          }
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

  // Prepend ban acknowledgment note so Claude handles it before any other context
  if (chatBanNote) {
    searchContext = searchContext ? `${chatBanNote}\n\n${searchContext}` : chatBanNote;
  }

  // Manual onboarding path: inject a hint when the user has 5+ favorites but recs aren't unlocked yet
  let onboardingHint: string | undefined;
  let isManualPath = false;
  try {
    const onboarding = await storage.getOnboardingState(userId);
    if (onboarding?.pathChosen === "manual" && !onboarding.unlockedRecommendations) {
      isManualPath = true;
      const ratings = await storage.getUserRatings(userId);
      const favoritedCount = ratings.filter((r) => r.rating >= 0.6).length;
      if (favoritedCount >= 5) {
        onboardingHint =
          `This user is on the manual onboarding path. They have favorited ${favoritedCount} anime. ` +
          `If you feel you have enough signal to start recommending, weave it naturally into your next message — ` +
          `something like "${displayName}, I think I'm starting to see you. Want to know what I see?" ` +
          `If you decide to unlock, end your message with the literal token [UNLOCK_RECS].`;
      }
    }
  } catch {
    // non-critical — onboarding hint is best-effort
  }

  const claudeResponse = await callClaude(message, history, userId, displayName, searchContext, onboardingHint);
  let response = claudeResponse ?? generateStarResponse(signals, matches, noMatchFallbacks, historyLength);

  // Handle Star deciding to unlock recommendations for the manual path
  if (isManualPath) {
    if (response.includes("[UNLOCK_RECS]")) {
      console.log(`[Path3] [UNLOCK_RECS] token detected in Star's response — stripping token and unlocking user=${userId}`);
      response = response.replace(/\[UNLOCK_RECS\]/g, "").trim();
      setImmediate(async () => {
        try {
          await storage.unlockRecommendations(userId);
          await storage.completeOnboarding(userId);
          console.log(`[Path3] Recommendations unlocked for user=${userId} via Star chat`);
        } catch (e) {
          console.error("[Path3] Failed to unlock via chat:", e instanceof Error ? e.message : e);
        }
      });
    } else {
      console.log(`[Path3] Manual-path response for user=${userId}: [UNLOCK_RECS] token not present (not ready to unlock yet)`);
    }
  }

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
