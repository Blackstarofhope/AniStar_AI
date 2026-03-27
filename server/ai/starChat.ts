import { getAllCurrentAnime, type AnimeScheduleItem } from "./animeData.js";
import {
  extractChatSignals, generateStarResponse, filterByGenres,
  STAR_NAME, STAR_BIO, type ChatSignals
} from "./starPersonality.js";
import { processFeedback, getTopAnimeByGenres } from "./recommendEngine.js";
import type { AnimeInfo } from "./textEmbedder.js";

export interface ChatMessage {
  role: "user" | "star";
  content: string;
}

export interface ChatResponse {
  response: string;
  implicitFeedback: boolean;
}

export { STAR_NAME, STAR_BIO };

export async function processChat(
  message: string,
  history: ChatMessage[]
): Promise<ChatResponse> {
  const catalog = await getAllCurrentAnime();
  const catalogTitles = catalog.map((a) => a.title);

  const signals = extractChatSignals(message, catalogTitles);

  const allGenres = [
    ...signals.likedGenres,
    ...signals.moodGenres,
  ];

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

  return { response, implicitFeedback };
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
