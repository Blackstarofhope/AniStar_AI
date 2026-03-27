import { normalize } from "./matrix.js";

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

export const EMBEDDING_DIM = GENRES.length + 1 + 1 + TOP_STUDIOS.length;

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

  const df: Record<string, number> = {};
  for (const anime of animeList) {
    const genres = new Set((anime.genres || []).map((g) => g.name));
    for (const g of genres) {
      df[g] = (df[g] || 0) + 1;
    }
  }

  const N = animeList.length;
  const vec = new Array(EMBEDDING_DIM).fill(0);
  const targetGenres = (targetAnime.genres || []).map((g) => g.name);

  for (const genreName of targetGenres) {
    const idx = GENRES.findIndex(
      (g) => g.toLowerCase() === genreName.toLowerCase()
    );
    if (idx >= 0) {
      const docFreq = df[genreName] || 1;
      const idf = Math.log((N + 1) / docFreq + 1);
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

  return normalize(vec);
}
