import { normalize } from "./matrix.js";
import { encodeText, loadCLIP, CLIP_DIM } from "./clipEncoder.js";

const GENRES = [
  "Action","Adventure","Cars","Comedy","Dementia","Demons","Drama",
  "Ecchi","Fantasy","Game","Harem","Historical","Horror","Josei",
  "Kids","Magic","Martial Arts","Mecha","Military","Music","Mystery",
  "Parody","Police","Psychological","Romance","Samurai","School",
  "Sci-Fi","Seinen","Shoujo","Shounen","Slice of Life","Space",
  "Sports","Super Power","Supernatural","Thriller","Vampire","Yaoi",
  "Yuri","Isekai","Iyashikei","Reverse Harem","Mahou Shoujo",
  "Time Travel","Dystopian","Villainess","Reincarnation","VRMMO","Dark Fantasy"
];

const TOP_STUDIOS = [
  "Madhouse","Bones","Sunrise","Production I.G","Toei Animation",
  "A-1 Pictures","ufotable","KyoAni","Trigger","MAPPA",
  "Shaft","J.C.Staff","White Fox","Doga Kobo","Wit Studio",
  "CloverWorks","PA Works","Brain's Base","Silver Link","Studio Deen"
];

export const EMBEDDING_DIM = CLIP_DIM;

export interface AnimeInfo {
  mal_id: number;
  title: string;
  genres?: { name: string }[];
  score?: number;
  episodes?: number;
  studios?: { name: string }[];
  synopsis?: string;
  rating?: string;
}

const SYNOPSIS_STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "is","are","was","were","be","been","being","have","has","had","do","does",
  "did","will","would","could","should","may","might","can","that","this",
  "it","its","he","she","they","we","i","you","his","her","their","our",
  "by","from","up","as","if","then","than","so","no","not","all","also",
  "into","about","after","when","who","which","what","where","how","one",
  "two","three","young","while","new","old","must","find","own","set","gets",
  "year","day","life","takes","called","after","becomes","begins","meets",
  "there","however","even","through"
]);

function synopsisTokens(synopsis: string): string[] {
  return synopsis
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3 && !SYNOPSIS_STOP_WORDS.has(t));
}

function hashMod(token: string, buckets: number): number {
  let h = 5381;
  for (let i = 0; i < token.length; i++) {
    h = ((h << 5) + h) ^ token.charCodeAt(i);
    h = h >>> 0;
  }
  return h % buckets;
}

export interface TFIDFContext {
  genreDocFreq: Record<string, number>;
  synopsisDocFreq: Record<string, number>;
  N: number;
}

export function buildTFIDFContext(animeList: AnimeInfo[]): TFIDFContext {
  const genreDocFreq: Record<string, number> = {};
  const synopsisDocFreq: Record<string, number> = {};
  const N = animeList.length;

  for (const anime of animeList) {
    const genres = new Set((anime.genres || []).map((g) => g.name));
    for (const g of genres) {
      genreDocFreq[g] = (genreDocFreq[g] || 0) + 1;
    }

    if (anime.synopsis && anime.synopsis.length >= 10) {
      const unique = new Set(synopsisTokens(anime.synopsis));
      for (const t of unique) {
        synopsisDocFreq[t] = (synopsisDocFreq[t] || 0) + 1;
      }
    }
  }

  return { genreDocFreq, synopsisDocFreq, N };
}

export function tfidfWeightWithContext(
  ctx: TFIDFContext,
  targetAnime: AnimeInfo
): number[] {
  const { genreDocFreq, synopsisDocFreq, N } = ctx;
  const vec = new Array(EMBEDDING_DIM).fill(0);

  const targetGenres = (targetAnime.genres || []).map((g) => g.name);
  for (const genreName of targetGenres) {
    const idx = GENRES.findIndex(
      (g) => g.toLowerCase() === genreName.toLowerCase()
    );
    if (idx >= 0) {
      const df = genreDocFreq[genreName] || 1;
      const idf = Math.log((N + 1) / df + 1);
      vec[idx] = idf;
    }
  }

  const scoreDim = GENRES.length;
  vec[scoreDim] = targetAnime.score ? Math.min(10, targetAnime.score) / 10 : 0.5;

  const epsDim = GENRES.length + 1;
  if (targetAnime.episodes && targetAnime.episodes > 0) {
    vec[epsDim] = Math.min(1, 1 / Math.log1p(targetAnime.episodes));
  } else {
    vec[epsDim] = 0.5;
  }

  const studioOffset = GENRES.length + 2;
  const animeStudios = (targetAnime.studios || []).map((s) => s.name);
  for (const studioName of animeStudios) {
    const idx = TOP_STUDIOS.findIndex(
      (s) => s.toLowerCase() === studioName.toLowerCase()
    );
    if (idx >= 0) {
      vec[studioOffset + idx] = 1;
    }
  }

  if (targetAnime.synopsis && targetAnime.synopsis.length >= 10) {
    const targetTokens = synopsisTokens(targetAnime.synopsis);
    const tf: Record<string, number> = {};
    for (const t of targetTokens) {
      tf[t] = (tf[t] || 0) + 1;
    }
    const totalTokens = targetTokens.length || 1;

    for (const [token, count] of Object.entries(tf)) {
      const termFreq = count / totalTokens;
      const df = synopsisDocFreq[token] || 1;
      const idf = Math.log((N + 1) / df + 1);
      const tfidfVal = termFreq * idf;
      const bucketIdx = hashMod(token, GENRES.length);
      vec[bucketIdx] += tfidfVal;
    }
  }

  return normalize(vec);
}

export function embedAnime(anime: AnimeInfo): number[] {
  const vec: number[] = new Array(EMBEDDING_DIM).fill(0);

  const animeGenres = (anime.genres || []).map((g) => g.name);
  for (const genreName of animeGenres) {
    const idx = GENRES.findIndex(
      (g) => g.toLowerCase() === genreName.toLowerCase()
    );
    if (idx >= 0) {
      vec[idx] = 1;
    }
  }

  const scoreDim = GENRES.length;
  vec[scoreDim] = anime.score ? Math.min(10, anime.score) / 10 : 0.5;

  const epsDim = GENRES.length + 1;
  if (anime.episodes && anime.episodes > 0) {
    vec[epsDim] = Math.min(1, 1 / Math.log1p(anime.episodes));
  } else {
    vec[epsDim] = 0.5;
  }

  const studioOffset = GENRES.length + 2;
  const animeStudios = (anime.studios || []).map((s) => s.name);
  for (const studioName of animeStudios) {
    const idx = TOP_STUDIOS.findIndex(
      (s) => s.toLowerCase() === studioName.toLowerCase()
    );
    if (idx >= 0) {
      vec[studioOffset + idx] = 1;
    }
  }

  return normalize(vec);
}

export function buildUserPreferenceVector(
  ratings: { embedding: number[]; rating: number }[]
): number[] {
  if (ratings.length === 0) {
    return new Array(EMBEDDING_DIM).fill(1 / Math.sqrt(EMBEDDING_DIM));
  }

  const pref = new Array(EMBEDDING_DIM).fill(0);
  let totalWeight = 0;

  for (const { embedding, rating } of ratings) {
    const weight = rating > 0.5 ? 1 + rating : -(1 - rating) * 0.5;
    totalWeight += Math.abs(weight);
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      pref[i] += weight * embedding[i];
    }
  }

  if (totalWeight > 0) {
    for (let i = 0; i < pref.length; i++) {
      pref[i] /= totalWeight;
    }
  }

  return normalize(pref);
}

export function tfidfWeight(
  animeList: AnimeInfo[],
  targetAnime: AnimeInfo
): number[] {
  if (animeList.length === 0) return embedAnime(targetAnime);
  const ctx = buildTFIDFContext(animeList);
  return tfidfWeightWithContext(ctx, targetAnime);
}

export async function embedAnimeCLIP(anime: AnimeInfo): Promise<number[]> {
  await loadCLIP();
  const genres = (anime.genres || []).map((g) => g.name).join(", ");
  const studios = (anime.studios || []).map((s) => s.name).join(", ");
  const synopsis = anime.synopsis ? anime.synopsis.slice(0, 200) : "";
  const text = [
    anime.title,
    genres ? `Genres: ${genres}` : "",
    studios ? `Studio: ${studios}` : "",
    synopsis,
  ]
    .filter(Boolean)
    .join(". ");
  const embedding = await encodeText(text);
  return Array.from(embedding);
}

export async function embedAnimeWithFallback(anime: AnimeInfo): Promise<number[]> {
  try {
    return await embedAnimeCLIP(anime);
  } catch {
    const fallback = embedAnime(anime);
    const padded = new Array(EMBEDDING_DIM).fill(0);
    for (let i = 0; i < fallback.length && i < EMBEDDING_DIM; i++) {
      padded[i] = fallback[i];
    }
    return padded;
  }
}
