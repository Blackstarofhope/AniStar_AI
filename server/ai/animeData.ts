import { storage } from "../storage.js";

export interface AnimeScheduleItem {
  mal_id: number;
  title: string;
  images: { jpg: { large_image_url: string } };
  broadcast?: { day?: string; time?: string };
  episodes?: number;
  score?: number;
  genres?: { name: string }[];
  studios?: { name: string }[];
  synopsis?: string;
  rating?: string;
  status?: string;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 30 * 60 * 1000;
const scheduleCache = new Map<string, CacheEntry<AnimeScheduleItem[]>>();
const detailsCache = new Map<number, CacheEntry<AnimeScheduleItem>>();
const anilistCache = new Map<number, CacheEntry<Partial<AnimeScheduleItem>>>();

const KIDS_RATINGS = new Set(["G - All Ages", "PG - Children"]);

function isKidsShow(item: AnimeScheduleItem): boolean {
  if (item.rating && KIDS_RATINGS.has(item.rating)) return true;
  if (item.genres) {
    const genreNames = item.genres.map((g) => g.name.toLowerCase());
    if (genreNames.includes("kids")) return true;
  }
  return false;
}

const JIKAN_BASE = "https://api.jikan.moe/v4";
const ANILIST_BASE = "https://graphql.anilist.co";

let lastSearchTime = 0;

async function jikanFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": "AniStar/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Jikan API error: ${res.status} ${url}`);
  }
  return res.json() as Promise<T>;
}

export async function getSchedule(day: string): Promise<AnimeScheduleItem[]> {
  const key = day.toLowerCase();
  const cached = scheduleCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const data = await jikanFetch<{ data: AnimeScheduleItem[] }>(
      `${JIKAN_BASE}/schedules?filter=${key}&kids=false&sfw=true&page=1`
    );
    const items = (data.data || [])
      .filter((a) => !isKidsShow(a))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    scheduleCache.set(key, { data: items, timestamp: Date.now() });
    return items;
  } catch {
    return cached?.data || [];
  }
}

export async function getSeasonalAnime(): Promise<AnimeScheduleItem[]> {
  const key = "seasonal";
  const cached = scheduleCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const data = await jikanFetch<{ data: AnimeScheduleItem[] }>(
      `${JIKAN_BASE}/seasons/now?limit=25&sfw=true`
    );
    const items = (data.data || []).filter((a) => !isKidsShow(a));
    scheduleCache.set(key, { data: items, timestamp: Date.now() });
    return items;
  } catch {
    return cached?.data || [];
  }
}

async function getPopularAiring(): Promise<AnimeScheduleItem[]> {
  const key = "popular_airing";
  const cached = scheduleCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const [byScore, byMembers] = await Promise.allSettled([
      jikanFetch<{ data: AnimeScheduleItem[] }>(
        `${JIKAN_BASE}/anime?type=tv&status=airing&order_by=score&sort=desc&min_score=6&sfw=true&page=1&limit=25`
      ),
      jikanFetch<{ data: AnimeScheduleItem[] }>(
        `${JIKAN_BASE}/anime?type=tv&status=airing&order_by=members&sort=desc&sfw=true&page=1&limit=25`
      ),
    ]);

    const seen = new Set<number>();
    const items: AnimeScheduleItem[] = [];

    for (const result of [byScore, byMembers]) {
      if (result.status === "fulfilled") {
        for (const a of result.value.data || []) {
          if (!seen.has(a.mal_id) && !isKidsShow(a)) {
            seen.add(a.mal_id);
            items.push(a);
          }
        }
      }
    }

    scheduleCache.set(key, { data: items, timestamp: Date.now() });
    return items;
  } catch {
    return cached?.data || [];
  }
}

export async function getAnimeDetails(malId: number): Promise<AnimeScheduleItem | null> {
  const cached = detailsCache.get(malId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const data = await jikanFetch<{ data: AnimeScheduleItem }>(
      `${JIKAN_BASE}/anime/${malId}`
    );
    const item = data.data;
    if (!item) return null;

    const anilistData = await getAniListEnrichment(malId, item.title);
    const merged = { ...item, ...anilistData };

    detailsCache.set(malId, { data: merged, timestamp: Date.now() });
    return merged;
  } catch {
    return cached?.data || null;
  }
}

async function getAniListEnrichment(
  malId: number,
  title: string
): Promise<Partial<AnimeScheduleItem>> {
  const cached = anilistCache.get(malId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        genres
        averageScore
        episodes
        studios { nodes { name } }
      }
    }
  `;

  try {
    const res = await fetch(ANILIST_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query, variables: { search: title } }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return {};

    const json = await res.json() as {
      data?: { Media?: {
        genres?: string[];
        averageScore?: number;
        episodes?: number;
        studios?: { nodes?: { name: string }[] };
      } }
    };
    const media = json?.data?.Media;
    if (!media) return {};

    const partial: Partial<AnimeScheduleItem> = {};

    if (media.genres && media.genres.length > 0) {
      partial.genres = media.genres.map((g) => ({ name: g }));
    }

    if (media.averageScore && media.averageScore > 0 && !partial.score) {
      partial.score = media.averageScore / 10;
    }

    if (media.episodes && media.episodes > 0) {
      partial.episodes = media.episodes;
    }

    if (media.studios?.nodes && media.studios.nodes.length > 0) {
      partial.studios = media.studios.nodes.map((s) => ({ name: s.name }));
    }

    anilistCache.set(malId, { data: partial, timestamp: Date.now() });
    return partial;
  } catch {
    return {};
  }
}

function allDaysCached(): boolean {
  const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  return days.every((d) => {
    const cached = scheduleCache.get(d);
    return cached && Date.now() - cached.timestamp < CACHE_TTL;
  });
}

export async function getAllCurrentAnime(): Promise<AnimeScheduleItem[]> {
  const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  const seen = new Set<number>();
  const result: AnimeScheduleItem[] = [];

  const [seasonal, popular] = await Promise.allSettled([
    getSeasonalAnime(),
    getPopularAiring(),
  ]);

  const isCached = allDaysCached();
  const dayResults: AnimeScheduleItem[][] = [];
  for (let i = 0; i < days.length; i++) {
    if (i > 0 && !isCached) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    try {
      dayResults.push(await getSchedule(days[i]));
    } catch {
      dayResults.push([]);
    }
  }

  for (const r of [seasonal, popular]) {
    if (r.status === "fulfilled") {
      for (const a of r.value) {
        if (!seen.has(a.mal_id) && !isKidsShow(a)) {
          seen.add(a.mal_id);
          result.push(a);
        }
      }
    }
  }

  for (const items of dayResults) {
    for (const a of items) {
      if (!seen.has(a.mal_id) && !isKidsShow(a)) {
        seen.add(a.mal_id);
        result.push(a);
      }
    }
  }

  const searched = scheduleCache.get("searched");
  if (searched) {
    for (const a of searched.data) {
      if (!seen.has(a.mal_id) && !isKidsShow(a)) {
        seen.add(a.mal_id);
        result.push(a);
      }
    }
  }

  result.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return result;
}

export async function searchAndAddAnime(query: string): Promise<AnimeScheduleItem[]> {
  const now = Date.now();
  if (now - lastSearchTime < 1000) return [];
  lastSearchTime = now;

  try {
    const data = await jikanFetch<{ data: AnimeScheduleItem[] }>(
      `${JIKAN_BASE}/anime?q=${encodeURIComponent(query)}&limit=5&sfw=true`
    );
    const results = (data.data || []).filter((a) => !isKidsShow(a));
    if (results.length === 0) return [];

    const existing = scheduleCache.get("searched");
    const existingData = existing?.data ?? [];
    const seen = new Set(existingData.map((a) => a.mal_id));
    const merged = [...existingData];

    for (const item of results) {
      if (!seen.has(item.mal_id)) {
        merged.push(item);
        seen.add(item.mal_id);
        storage.saveSearchedAnime(item.mal_id, item as unknown as object).catch((e) => {
          console.warn("[AnimeData] Failed to persist searched anime:", e instanceof Error ? e.message : e);
        });
      }
    }

    scheduleCache.set("searched", { data: merged.slice(-200), timestamp: Date.now() });
    return results;
  } catch {
    return [];
  }
}

export async function initAnimeData(): Promise<void> {
  try {
    const rows = await storage.getAllSearchedAnime();
    if (rows.length === 0) return;

    const items = rows.map((r) => r.data as AnimeScheduleItem).filter((a) => a && a.mal_id);
    const existing = scheduleCache.get("searched");
    const existingData = existing?.data ?? [];
    const seen = new Set(existingData.map((a) => a.mal_id));
    const merged = [...existingData];

    for (const item of items) {
      if (!seen.has(item.mal_id) && !isKidsShow(item)) {
        merged.push(item);
        seen.add(item.mal_id);
      }
    }

    scheduleCache.set("searched", { data: merged.slice(-200), timestamp: Date.now() });
    console.log(`[AnimeData] Loaded ${items.length} searched anime from DB.`);
  } catch (e) {
    console.warn("[AnimeData] Failed to load searched anime from DB:", e instanceof Error ? e.message : e);
  }
}

export function clearAnimeCache(): void {
  scheduleCache.clear();
  detailsCache.clear();
  anilistCache.clear();
}
