import { getAllCurrentAnime, type AnimeScheduleItem } from "./animeData.js";
import {
  extractChatSignals, generateStarResponse, filterByGenres,
  STAR_NAME, STAR_BIO, type ChatSignals,
} from "./starPersonality.js";
import { processFeedback, getTopAnimeByGenres } from "./recommendEngine.js";
import type { AnimeInfo } from "./textEmbedder.js";
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

export async function processChat(
  message: string,
  history: ChatMessage[]
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
  const response = generateStarResponse(signals, matches, noMatchFallbacks, historyLength);

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
