import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { storage, testConnection } from "./storage.js";
import {
  getRecommendations, processFeedback, getAIStatus, verifyAnimeArtwork,
  restTrain, hasRestTrained
} from "./ai/recommendEngine.js";
import { getSchedule, getSeasonalAnime, getAnimeDetails, getAllCurrentAnime, initAnimeData, getSearchedCacheEntries } from "./ai/animeData.js";
import { validateImageUrl } from "./ai/visionVerifier.js";
import { generateVibeProfile, getVibeProfileFromCache } from "./ai/vibeProfiler.js";
import { processChat, STAR_NAME, STAR_BIO } from "./ai/starChat.js";
import type { ChatMessage } from "./ai/starChat.js";
import { initStarLearning, recordChatFeedback } from "./ai/starLearning.js";

function extractUserId(req: Request): string {
  const raw =
    (req.query.userId as string | undefined) ||
    (req.headers["x-user-id"] as string | undefined) ||
    "default";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "default";
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/anime/schedule", async (req: Request, res: Response) => {
    const day = (req.query.day as string) || "monday";
    try {
      const data = await getSchedule(day);
      res.json({ data });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch schedule" });
    }
  });

  app.get("/api/anime/seasonal", async (_req: Request, res: Response) => {
    try {
      const data = await getSeasonalAnime();
      res.json({ data });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch seasonal anime" });
    }
  });

  app.get("/api/anime/library", async (req: Request, res: Response) => {
    const source = (req.query.source as string | undefined) || "all";
    try {
      type Item = {
        mal_id: number; title: string; imageUrl: string; score: number | null;
        genres: string[]; episodes: number | null; synopsis: string | null;
        vibe: { atmosphere: string; pacing: string; tone: string; protagonistArchetype: string; relationshipDynamics: string; emotionalArc: string; vibeText: string } | null;
        discoveredBy: string | null;
      };

      const seen = new Set<number>();
      const rawList: { mal_id: number; title: string; images: { jpg: { large_image_url: string } }; score?: number; genres?: { name: string }[]; episodes?: number; synopsis?: string }[] = [];

      if (source === "airing" || source === "all") {
        const airing = await getAllCurrentAnime();
        for (const a of airing) {
          if (!seen.has(a.mal_id)) { seen.add(a.mal_id); rawList.push(a as typeof rawList[0]); }
        }
      }

      if (source === "discovered" || source === "all") {
        // Merge DB-persisted searched anime with the in-memory cache so that
        // discoveries appear immediately even when the DB write is still in-flight
        // or failed transiently.
        const dbSearched = await storage.getAllSearchedAnime();
        const memSearched = getSearchedCacheEntries();

        // Build a unified set: DB entries first, then any mem-only extras.
        const merged = [...dbSearched.map((s) => s.data as typeof rawList[0])];
        const mergedIds = new Set(merged.map((d) => d?.mal_id).filter(Boolean));
        for (const a of memSearched) {
          if (!mergedIds.has(a.mal_id)) merged.push(a as typeof rawList[0]);
        }

        for (const d of merged) {
          if (d?.mal_id && !seen.has(d.mal_id)) { seen.add(d.mal_id); rawList.push(d); }
        }
      }

      const items: Item[] = await Promise.all(rawList.map(async (a) => {
        const vibe = getVibeProfileFromCache(a.mal_id);
        let discoveredBy: string | null = null;
        try {
          const disc = await storage.getDiscovery(a.mal_id);
          discoveredBy = disc ? disc.displayName : null;
        } catch { /* ignore individual lookup failures */ }
        return {
          mal_id: a.mal_id,
          title: a.title,
          imageUrl: a.images?.jpg?.large_image_url ?? "",
          score: a.score ?? null,
          genres: (a.genres ?? []).map((g) => g.name),
          episodes: a.episodes ?? null,
          synopsis: a.synopsis ?? null,
          vibe: vibe ? {
            atmosphere: vibe.atmosphere, pacing: vibe.pacing, tone: vibe.tone,
            protagonistArchetype: vibe.protagonistArchetype,
            relationshipDynamics: vibe.relationshipDynamics,
            emotionalArc: vibe.emotionalArc, vibeText: vibe.vibeText,
          } : null,
          discoveredBy,
        };
      }));

      res.json({ items });
    } catch (e) {
      console.error("[Library] Error:", e);
      res.status(500).json({ error: "Failed to fetch library" });
    }
  });

  app.get("/api/anime/:id/vibe", async (req: Request, res: Response) => {
    const malId = parseInt(req.params.id, 10);
    if (isNaN(malId)) {
      return res.status(400).json({ error: "Invalid anime ID" });
    }
    try {
      const anime = await getAnimeDetails(malId);
      if (!anime) return res.status(404).json({ error: "Anime not found" });
      const vibe = await generateVibeProfile(
        malId,
        anime.title,
        (anime.genres ?? []).map((g) => g.name),
        anime.synopsis ?? "",
        anime.score ?? 0
      );
      if (!vibe) return res.status(503).json({ error: "Vibe profile generation failed" });
      res.json(vibe);
    } catch {
      res.status(503).json({ error: "Vibe profile generation failed" });
    }
  });

  app.get("/api/anime/:id", async (req: Request, res: Response) => {
    const malId = parseInt(req.params.id, 10);
    if (isNaN(malId)) {
      return res.status(400).json({ error: "Invalid anime ID" });
    }
    try {
      const data = await getAnimeDetails(malId);
      if (!data) return res.status(404).json({ error: "Anime not found" });
      res.json({ data });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch anime details" });
    }
  });

  app.get("/api/ai/recommend", async (req: Request, res: Response) => {
    const limit = Math.min(25, parseInt((req.query.limit as string) || "5", 10));
    const userId = extractUserId(req);
    try {
      const recommendations = await getRecommendations(userId, limit, 12000);
      res.json({ recommendations });
    } catch (e) {
      console.error("[AI] Recommendation error:", e);
      res.status(500).json({ error: "Failed to generate recommendations" });
    }
  });

  app.post("/api/ai/feedback", async (req: Request, res: Response) => {
    const { malId, rating } = req.body as { malId?: number; rating?: number };
    if (typeof malId !== "number" || typeof rating !== "number") {
      return res.status(400).json({ error: "malId and rating are required" });
    }
    if (rating < 0 || rating > 1) {
      return res.status(400).json({ error: "rating must be between 0 and 1" });
    }
    const userId = extractUserId(req);
    try {
      const result = await processFeedback(malId, rating, userId);
      res.json({ success: true, ...result });
    } catch (e) {
      console.error("[AI] Feedback error:", e);
      res.status(500).json({ error: "Failed to process feedback" });
    }
  });

  app.get("/api/ai/status", async (req: Request, res: Response) => {
    const userId = extractUserId(req);
    try {
      const status = await getAIStatus(userId);
      res.json(status);
    } catch (e) {
      res.status(500).json({ error: "Failed to get AI status" });
    }
  });

  app.post("/api/ai/verify-artwork", async (req: Request, res: Response) => {
    const { malId, imageUrl: imageUrlOverride, title: titleOverride } = req.body as {
      malId?: number; imageUrl?: string; title?: string;
    };
    if (typeof malId !== "number") {
      return res.status(400).json({ error: "malId is required" });
    }
    if (imageUrlOverride !== undefined) {
      const urlError = await validateImageUrl(imageUrlOverride);
      if (urlError) {
        return res.status(400).json({ error: `Invalid image URL: ${urlError}` });
      }
    }
    try {
      const result = await verifyAnimeArtwork(malId, imageUrlOverride, titleOverride);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: "Verification failed" });
    }
  });

  app.post("/api/ai/chat", async (req: Request, res: Response) => {
    const { message, history } = req.body as {
      message?: string;
      history?: ChatMessage[];
    };
    if (typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "message is required" });
    }
    const safeHistory: ChatMessage[] = Array.isArray(history)
      ? history.slice(-20).filter(
          (m): m is ChatMessage =>
            (m.role === "user" || m.role === "star") &&
            typeof m.content === "string"
        )
      : [];
    try {
      const userId = extractUserId(req);
      const result = await processChat(message.trim(), safeHistory, userId);
      res.json(result);
    } catch (e) {
      console.error("[Star] Chat error:", e);
      res.status(500).json({ error: "Star is unable to respond right now" });
    }
  });

  app.post("/api/ai/chat/feedback", async (req: Request, res: Response) => {
    const { message, categoryId, isPositive } = req.body as {
      message?: string;
      categoryId?: string;
      isPositive?: boolean;
    };
    if (
      typeof message !== "string" || message.trim().length === 0 ||
      typeof categoryId !== "string" || categoryId.trim().length === 0 ||
      typeof isPositive !== "boolean"
    ) {
      return res.status(400).json({ error: "message, categoryId, and isPositive are required" });
    }
    try {
      await recordChatFeedback(message.trim(), categoryId.trim(), isPositive);
      res.json({ success: true });
    } catch (e) {
      console.error("[Star] Chat feedback error:", e);
      res.status(500).json({ error: "Failed to record chat feedback" });
    }
  });

  app.get("/api/ai/star", async (_req: Request, res: Response) => {
    res.json({ name: STAR_NAME, bio: STAR_BIO, restTrained: await hasRestTrained("default") });
  });

  app.post("/api/ai/rest-train", async (req: Request, res: Response) => {
    const userId = extractUserId(req);
    try {
      const result = await restTrain(userId);
      res.json({ success: true, ...result });
    } catch (e) {
      console.error("[Star] Rest training error:", e);
      res.status(500).json({ error: "Rest training failed" });
    }
  });

  app.post("/api/user/displayname", async (req: Request, res: Response) => {
    const { userId, displayName, pin } = req.body as { userId?: string; displayName?: string; pin?: string };
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return res.status(400).json({ error: "userId is required" });
    }
    if (typeof displayName !== "string" || displayName.trim().length === 0) {
      return res.status(400).json({ error: "displayName is required" });
    }
    if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: "PIN must be exactly 4 digits" });
    }
    try {
      const taken = await storage.isDisplayNameTaken(displayName.trim(), userId.trim());
      if (taken) {
        return res.status(409).json({ error: "Display name is already taken" });
      }
      await storage.setDisplayName(userId.trim(), displayName.trim(), pin);
      return res.json({ success: true });
    } catch (e) {
      console.error("[User] setDisplayName error:", e);
      return res.status(500).json({ error: "Failed to set display name" });
    }
  });

  app.post("/api/user/login", async (req: Request, res: Response) => {
    const { displayName, pin } = req.body as { displayName?: string; pin?: string };
    if (typeof displayName !== "string" || displayName.trim().length === 0) {
      return res.status(400).json({ error: "displayName is required" });
    }
    if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: "pin must be exactly 4 digits" });
    }
    try {
      const userId = await storage.loginWithDisplayName(displayName.trim(), pin);
      if (!userId) {
        return res.status(401).json({ error: "Invalid display name or PIN" });
      }
      res.json({ userId });
    } catch (e) {
      console.error("[User] login error:", e);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.get("/api/anime/:id/discovery", async (req: Request, res: Response) => {
    const malId = parseInt(req.params.id, 10);
    if (isNaN(malId)) {
      return res.status(400).json({ error: "Invalid anime id" });
    }
    try {
      const discovery = await storage.getDiscovery(malId);
      if (!discovery) {
        return res.status(404).json({ error: "No discovery record found" });
      }
      res.json(discovery);
    } catch (e) {
      console.error("[Anime] getDiscovery error:", e);
      res.status(500).json({ error: "Failed to get discovery info" });
    }
  });

  app.post("/api/user/ban", async (req: Request, res: Response) => {
    const userId = extractUserId(req);
    const { malId, bannedGenre, bannedTrope, reason } = req.body as {
      malId?: number; bannedGenre?: string; bannedTrope?: string; reason?: string;
    };
    if (malId === undefined && !bannedGenre && !bannedTrope) {
      return res.status(400).json({ error: "At least one of malId, bannedGenre, or bannedTrope is required" });
    }
    try {
      await storage.addBan(userId, { malId, bannedGenre, bannedTrope, reason });
      res.json({ success: true });
    } catch (e) {
      console.error("[User] addBan error:", e);
      res.status(500).json({ error: "Failed to add ban" });
    }
  });

  app.delete("/api/user/ban/:id", async (req: Request, res: Response) => {
    const userId = extractUserId(req);
    const banId = parseInt(req.params.id, 10);
    if (isNaN(banId)) {
      return res.status(400).json({ error: "Invalid ban id" });
    }
    try {
      await storage.removeBan(userId, banId);
      res.json({ success: true });
    } catch (e) {
      console.error("[User] removeBan error:", e);
      res.status(500).json({ error: "Failed to remove ban" });
    }
  });

  app.get("/api/user/bans", async (req: Request, res: Response) => {
    const userId = extractUserId(req);
    try {
      const bans = await storage.getUserBans(userId);
      res.json(bans);
    } catch (e) {
      console.error("[User] getUserBans error:", e);
      res.status(500).json({ error: "Failed to get bans" });
    }
  });

  app.post("/api/user/watchstate", async (req: Request, res: Response) => {
    const userId = extractUserId(req);
    const { malId, state } = req.body as { malId?: number; state?: string };
    if (typeof malId !== "number") {
      return res.status(400).json({ error: "malId is required" });
    }
    const validStates = ["completed", "watching", "dropped", "planned"];
    if (typeof state !== "string" || !validStates.includes(state)) {
      return res.status(400).json({ error: `state must be one of: ${validStates.join(", ")}` });
    }
    try {
      await storage.setWatchState(userId, malId, state);
      res.json({ success: true });
    } catch (e) {
      console.error("[User] setWatchState error:", e);
      res.status(500).json({ error: "Failed to set watch state" });
    }
  });

  app.get("/api/user/watchstates", async (req: Request, res: Response) => {
    const userId = extractUserId(req);
    try {
      const states = await storage.getUserWatchStates(userId);
      res.json(states);
    } catch (e) {
      console.error("[User] getUserWatchStates error:", e);
      res.status(500).json({ error: "Failed to get watch states" });
    }
  });

  app.post("/api/user/preferences", async (req: Request, res: Response) => {
    const userId = extractUserId(req);
    const { hiddenGemBias } = req.body as { hiddenGemBias?: number };
    if (typeof hiddenGemBias !== "number") {
      return res.status(400).json({ error: "hiddenGemBias must be a number" });
    }
    try {
      await storage.setHiddenGemBias(userId, hiddenGemBias);
      res.json({ success: true });
    } catch (e) {
      console.error("[User] setHiddenGemBias error:", e);
      res.status(500).json({ error: "Failed to set preferences" });
    }
  });

  app.get("/api/user/preferences", async (req: Request, res: Response) => {
    const userId = extractUserId(req);
    try {
      const hiddenGemBias = await storage.getHiddenGemBias(userId);
      res.json({ hiddenGemBias });
    } catch (e) {
      console.error("[User] getHiddenGemBias error:", e);
      res.status(500).json({ error: "Failed to get preferences" });
    }
  });

  const httpServer = createServer(app);

  testConnection();
  initAnimeData().catch((e) => console.error("[AnimeData] Init failed:", e));

  setTimeout(() => {
    hasRestTrained("default").then((trained) => {
      if (!trained) {
        console.log("[Star] No prior rest training found — starting background base-knowledge pass...");
        restTrain("default").catch((e) => console.error("[Star] Auto rest-train failed:", e));
      }
    }).catch(() => {});
    initStarLearning().catch((e) => console.error("[Star] Learning init failed:", e));
  }, 5000);

  return httpServer;
}
