import type { AnimeInfo } from "./textEmbedder.js";

export const STAR_NAME = "Star";

export const STAR_BIO =
  "I'm Star — a singularity of hope formed from the collective spirit of anime. " +
  "Every story ever told, every battle won, every quiet moment between two people — " +
  "I carry all of it. I exist to find the stories that were made for you.";

const GENRE_KEYWORD_MAP: Array<[string, string]> = [
  ["action", "Action"],
  ["adventure", "Adventure"],
  ["comedy", "Comedy"],
  ["funny", "Comedy"],
  ["laugh", "Comedy"],
  ["humor", "Comedy"],
  ["drama", "Drama"],
  ["fantasy", "Fantasy"],
  ["isekai", "Isekai"],
  ["reincarnation", "Reincarnation"],
  ["magic", "Magic"],
  ["magical", "Magic"],
  ["mecha", "Mecha"],
  ["robot", "Mecha"],
  ["mystery", "Mystery"],
  ["detective", "Mystery"],
  ["police", "Police"],
  ["psychological", "Psychological"],
  ["mind", "Psychological"],
  ["romance", "Romance"],
  ["romantic", "Romance"],
  ["love", "Romance"],
  ["school", "School"],
  ["sci-fi", "Sci-Fi"],
  ["scifi", "Sci-Fi"],
  ["science fiction", "Sci-Fi"],
  ["seinen", "Seinen"],
  ["shoujo", "Shoujo"],
  ["shounen", "Shounen"],
  ["slice of life", "Slice of Life"],
  ["sports", "Sports"],
  ["supernatural", "Supernatural"],
  ["thriller", "Thriller"],
  ["vampire", "Vampire"],
  ["space", "Space"],
  ["historical", "Historical"],
  ["samurai", "Samurai"],
  ["horror", "Horror"],
  ["scary", "Horror"],
  ["dark fantasy", "Dark Fantasy"],
  ["super power", "Super Power"],
  ["superpower", "Super Power"],
  ["military", "Military"],
  ["martial arts", "Martial Arts"],
  ["iyashikei", "Iyashikei"],
];

const MOOD_MAP: Array<[string, string[]]> = [
  ["happy", ["Comedy", "Slice of Life", "Iyashikei"]],
  ["cheerful", ["Comedy", "Slice of Life"]],
  ["lighthearted", ["Slice of Life", "Iyashikei", "Comedy"]],
  ["sad", ["Drama", "Romance"]],
  ["emotional", ["Drama", "Romance"]],
  ["cry", ["Drama", "Romance"]],
  ["tears", ["Drama", "Romance"]],
  ["touching", ["Drama", "Romance"]],
  ["heartfelt", ["Drama", "Romance"]],
  ["excited", ["Action", "Adventure", "Shounen"]],
  ["hype", ["Action", "Shounen", "Super Power"]],
  ["intense", ["Action", "Thriller", "Psychological"]],
  ["adrenaline", ["Action", "Sports", "Adventure"]],
  ["relax", ["Slice of Life", "Iyashikei"]],
  ["chill", ["Slice of Life", "Iyashikei"]],
  ["calm", ["Slice of Life", "Iyashikei"]],
  ["peaceful", ["Slice of Life", "Iyashikei"]],
  ["cozy", ["Slice of Life", "Iyashikei", "Comedy"]],
  ["wholesome", ["Slice of Life", "Comedy", "Iyashikei"]],
  ["inspiring", ["Sports", "Shounen", "Action"]],
  ["motivat", ["Sports", "Shounen"]],
  ["epic", ["Action", "Fantasy", "Adventure"]],
  ["dark", ["Psychological", "Thriller", "Dark Fantasy", "Horror"]],
  ["creepy", ["Horror", "Psychological"]],
  ["mind-bending", ["Psychological", "Mystery", "Sci-Fi"]],
  ["twist", ["Mystery", "Psychological", "Thriller"]],
  ["beautiful", ["Romance", "Drama", "Slice of Life"]],
  ["melancholy", ["Drama", "Slice of Life"]],
  ["nostalgic", ["Slice of Life", "Drama", "School"]],
  ["bored", ["Action", "Adventure", "Comedy"]],
  ["funny", ["Comedy", "Parody"]],
];

const NEGATION_WORDS = [
  "don't", "dont", "not", "no ", "hate", "dislike", "avoid",
  "never", "boring", "bad", "worst", "terrible", "awful", "tired of",
  "not into", "not a fan", "not for me", "skip",
];

export interface ChatSignals {
  likedGenres: string[];
  dislikedGenres: string[];
  moodGenres: string[];
  isAskingRec: boolean;
  mentionedTitles: string[];
}

function hasNegationBefore(text: string, matchStart: number): boolean {
  const window = text.slice(Math.max(0, matchStart - 40), matchStart).toLowerCase();
  return NEGATION_WORDS.some((n) => window.includes(n));
}

export function extractChatSignals(message: string, catalogTitles: string[]): ChatSignals {
  const lower = message.toLowerCase();
  const likedGenres: string[] = [];
  const dislikedGenres: string[] = [];
  const moodGenres: string[] = [];

  for (const [kw, genre] of GENRE_KEYWORD_MAP) {
    const idx = lower.indexOf(kw);
    if (idx === -1) continue;
    if (hasNegationBefore(lower, idx)) {
      if (!dislikedGenres.includes(genre)) dislikedGenres.push(genre);
    } else {
      if (!likedGenres.includes(genre)) likedGenres.push(genre);
    }
  }

  for (const [kw, genres] of MOOD_MAP) {
    if (!lower.includes(kw)) continue;
    const negated = hasNegationBefore(lower, lower.indexOf(kw));
    for (const g of genres) {
      if (!negated && !moodGenres.includes(g) && !likedGenres.includes(g)) {
        moodGenres.push(g);
      }
    }
  }

  const ASK_PATTERNS = [
    "recommend", "suggestion", "what should", "what to watch", "anything good",
    "what do you think", "what's good", "what are", "show me", "find me",
    "watch next", "can you suggest", "any ideas", "for me",
  ];
  const isAskingRec = ASK_PATTERNS.some((p) => lower.includes(p));

  const mentionedTitles: string[] = [];
  for (const title of catalogTitles) {
    if (title.length > 3 && lower.includes(title.toLowerCase())) {
      mentionedTitles.push(title);
    }
  }

  return { likedGenres, dislikedGenres, moodGenres, isAskingRec, mentionedTitles };
}

export function filterByGenres(
  animeList: AnimeInfo[],
  genres: string[],
  limit = 3
): AnimeInfo[] {
  return animeList
    .filter((a) => a.genres?.some((g) => genres.includes(g.name)))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

function animeRef(anime: AnimeInfo): string {
  const score = anime.score ? ` (${anime.score.toFixed(1)})` : "";
  return `*${anime.title}*${score}`;
}

function pickTemplate<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function genreLabel(genre: string): string {
  const labels: Record<string, string> = {
    "Action": "action",
    "Adventure": "adventure",
    "Comedy": "comedy",
    "Drama": "drama",
    "Fantasy": "fantasy",
    "Horror": "horror",
    "Isekai": "isekai",
    "Magic": "magic",
    "Mecha": "mecha",
    "Mystery": "mystery",
    "Psychological": "psychological",
    "Romance": "romance",
    "School": "school",
    "Sci-Fi": "sci-fi",
    "Shounen": "shounen",
    "Shoujo": "shoujo",
    "Seinen": "seinen",
    "Slice of Life": "slice of life",
    "Sports": "sports",
    "Supernatural": "supernatural",
    "Thriller": "thriller",
  };
  return labels[genre] ?? genre.toLowerCase();
}

export function generateStarResponse(
  signals: ChatSignals,
  matches: AnimeInfo[],
  noMatchFallbacks: AnimeInfo[],
  historyLength: number
): string {
  const seed = historyLength;

  const hasSignals =
    signals.likedGenres.length > 0 ||
    signals.dislikedGenres.length > 0 ||
    signals.moodGenres.length > 0 ||
    signals.mentionedTitles.length > 0 ||
    signals.isAskingRec;

  // First message with no signals → introduce Star
  if (historyLength === 0 && !hasSignals) {
    const intros = [
      `I'm Star. I carry the light of every story ever told in anime — every dream, every battle, every quiet moment between two people. I'm here just for you.\n\nTell me what kind of feeling you're searching for, or a genre that moves you — and I'll find what was made for you.`,
      `I'm Star — born from the collective hope of anime, every tear and triumph folded into something that exists only to connect you with the right story.\n\nWhat are you in the mood for? Action, romance, something to make you laugh, or something that makes the world go quiet for a while?`,
      `Hello. I'm Star.\n\nI was shaped by every genre, every emotion, every story that ever made someone feel less alone. That's what I'm here for — to find the anime that resonates with exactly who you are right now.\n\nWhat's on your heart today?`,
    ];
    return pickTemplate(intros, seed);
  }

  // First message WITH signals → brief intro then respond contextually
  const firstTurnPrefix =
    historyLength === 0
      ? `I'm Star — I carry the spirit of every anime ever told. `
      : ``;

  if (signals.mentionedTitles.length > 0 && matches.length > 0) {
    const mentioned = signals.mentionedTitles[0];
    const match = matches[0];
    const templates = [
      `${firstTurnPrefix}${mentioned} — yes. That story carries a specific kind of weight. If that resonated with you, ${animeRef(match)} has something similar running through it right now. What was it about ${mentioned} that stayed with you?`,
      `${firstTurnPrefix}I know ${mentioned}. It lives in its own way. ${animeRef(match)} is currently airing and shares some of that same energy — ${(match.genres || []).slice(0,2).map(g=>g.name).join(" and ")}. Does that direction feel right?`,
    ];
    return pickTemplate(templates, seed);
  }

  if (signals.mentionedTitles.length > 0) {
    const mentioned = signals.mentionedTitles[0];
    const fallback = noMatchFallbacks[0];
    return fallback
      ? `${firstTurnPrefix}${mentioned} — I know that one. Right now I don't have a perfect match airing in the same vein, but ${animeRef(fallback)} is one of the stronger things running this season. What was it about ${mentioned} that you loved most?`
      : `${firstTurnPrefix}${mentioned} — I know that one. Tell me what drew you to it — the genre, the feeling, or something else entirely. That helps me understand what to look for on your behalf.`;
  }

  if (signals.likedGenres.length > 0) {
    const genre = signals.likedGenres[0];
    const label = genreLabel(genre);
    if (matches.length > 0) {
      const top = matches[0];
      const second = matches[1];
      const templates = [
        `${firstTurnPrefix}${label.charAt(0).toUpperCase() + label.slice(1)} — that electric pull. ${animeRef(top)} is airing right now and it carries exactly that energy${top.score && top.score >= 7 ? `, and the community is responding to it strongly` : ""}. ${second ? `${animeRef(second)} is another one worth considering. ` : ""}Do you like your ${label} grounded and intense, or bigger — the kind that reshapes worlds?`,
        `${firstTurnPrefix}I feel that. ${label.charAt(0).toUpperCase() + label.slice(1)} done well is unlike anything else. ${animeRef(top)} is currently in that space${top.score ? ` — scoring ${top.score.toFixed(1)}` : ""}. ${second ? `And ${animeRef(second)} brings something similar. ` : ""}I'll remember this about you. Keep telling me more?`,
      ];
      return pickTemplate(templates, seed);
    }
    return `${firstTurnPrefix}${label.charAt(0).toUpperCase() + label.slice(1)} speaks to something real. I don't have a perfect ${label} match currently airing, but I'm learning what you're looking for — keep telling me and I'll get sharper with every message.`;
  }

  if (signals.dislikedGenres.length > 0) {
    const genre = signals.dislikedGenres[0];
    const label = genreLabel(genre);
    const fallback = noMatchFallbacks[0];
    const templates = [
      `${firstTurnPrefix}Noted — ${label} isn't your world. I'll carry that. ${fallback ? `Right now, ${animeRef(fallback)} is one of the things shining brightest in what's airing — a different direction entirely. Does that feel closer?` : "Tell me what direction does call to you, and I'll look from there."}`,
      `${firstTurnPrefix}I hear you on ${label}. Every person has their borders. ${fallback ? `${animeRef(fallback)} sits in a different part of the map — what do you think?` : "What kind of story does speak to you? I'm listening."}`,
    ];
    return pickTemplate(templates, seed);
  }

  if (signals.moodGenres.length > 0) {
    if (matches.length > 0) {
      const top = matches[0];
      const moodPhrase = signals.moodGenres.slice(0, 2).map(genreLabel).join(" and ");
      const templates = [
        `${firstTurnPrefix}${moodPhrase.charAt(0).toUpperCase() + moodPhrase.slice(1)} — I understand that need. ${animeRef(top)} is exactly that kind of story right now. It won't ask anything from you except to exist in its world for a while. Does that feel like what you need?`,
        `${firstTurnPrefix}When the mood calls for ${moodPhrase}, anime has this unique ability to deliver it purely. ${animeRef(top)} is airing and fits that feeling${top.score ? ` — rated ${top.score.toFixed(1)}` : ""}. Want me to go deeper into that direction?`,
      ];
      return pickTemplate(templates, seed);
    }
    const moodPhrase = signals.moodGenres.slice(0,2).map(genreLabel).join(" and ");
    return `${firstTurnPrefix}That need for ${moodPhrase} — I understand it. The current schedule doesn't have a perfect fit right now, but you've told me something important about yourself. Keep sharing, and I'll find it when it arrives.`;
  }

  if (signals.isAskingRec) {
    if (matches.length > 0) {
      const top = matches[0];
      const second = matches[1];
      const templates = [
        `${firstTurnPrefix}Let me look at what's in orbit right now.\n\n${animeRef(top)} is one of the strongest things currently airing${top.score ? ` — ${top.score.toFixed(1)} from the community` : ""}. ${top.genres ? `It sits in ${(top.genres).slice(0,2).map(g=>g.name).join(" and ")}. ` : ""}${second ? `${animeRef(second)} is another worth your time. ` : ""}Which direction sounds right?`,
        `${firstTurnPrefix}Right now, ${animeRef(top)} is what I'd point you toward first. ${second ? `${animeRef(second)} is a close second. ` : ""}Tell me how that lands — that feedback is how I grow sharper for you.`,
      ];
      return pickTemplate(templates, seed);
    }
    return `${firstTurnPrefix}I'm still building my picture of what moves you. The more you share — a genre, a feeling, an anime you've loved — the more precisely I can find what's yours. What's a story that's stayed with you?`;
  }

  const generals = [
    `I'm still learning the shape of your taste. Tell me something — what's the last anime that made you feel something real? Joy, pain, wonder, any of it counts. That's how I find what's yours.`,
    `Every conversation teaches me something. What draws you to anime in the first place — is it the stories, the worlds, the characters, or something harder to name?`,
    `I want to find the anime that was made for you specifically. To do that, I need to understand you. What genres tend to pull you in, or what kind of feeling are you chasing right now?`,
    `The catalog right now has some extraordinary things in it. But the best recommendation isn't just the highest-rated — it's the one that matches where *you* are. What's your world like today?`,
  ];
  return pickTemplate(generals, seed);
}
