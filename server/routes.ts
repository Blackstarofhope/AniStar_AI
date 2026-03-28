import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import {
  getRecommendations, processFeedback, getAIStatus, verifyAnimeArtwork,
  restTrain, hasRestTrained
} from "./ai/recommendEngine.js";
import { getSchedule, getSeasonalAnime, getAnimeDetails } from "./ai/animeData.js";
import { validateImageUrl } from "./ai/visionVerifier.js";
import { processChat, STAR_NAME, STAR_BIO } from "./ai/starChat.js";
import type { ChatMessage } from "./ai/starChat.js";
import { initStarLearning, recordChatFeedback } from "./ai/starLearning.js";

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
    try {
      const recommendations = await getRecommendations(limit, 12000);
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
    try {
      const result = await processFeedback(malId, rating);
      res.json({ success: true, ...result });
    } catch (e) {
      console.error("[AI] Feedback error:", e);
      res.status(500).json({ error: "Failed to process feedback" });
    }
  });

  app.get("/api/ai/status", (_req: Request, res: Response) => {
    try {
      const status = getAIStatus();
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
      const result = await processChat(message.trim(), safeHistory);
      res.json(result);
    } catch (e) {
      console.error("[Star] Chat error:", e);
      res.status(500).json({ error: "Star is unable to respond right now" });
    }
  });

  app.post("/api/ai/chat/feedback", (req: Request, res: Response) => {
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
      recordChatFeedback(message.trim(), categoryId.trim(), isPositive);
      res.json({ success: true });
    } catch (e) {
      console.error("[Star] Chat feedback error:", e);
      res.status(500).json({ error: "Failed to record chat feedback" });
    }
  });

  app.get("/api/ai/star", (_req: Request, res: Response) => {
    res.json({ name: STAR_NAME, bio: STAR_BIO, restTrained: hasRestTrained() });
  });

  app.post("/api/ai/rest-train", async (_req: Request, res: Response) => {
    try {
      const result = await restTrain();
      res.json({ success: true, ...result });
    } catch (e) {
      console.error("[Star] Rest training error:", e);
      res.status(500).json({ error: "Rest training failed" });
    }
  });

  const httpServer = createServer(app);

  setTimeout(() => {
    if (!hasRestTrained()) {
      console.log("[Star] No prior rest training found — starting background base-knowledge pass...");
      restTrain().catch((e) => console.error("[Star] Auto rest-train failed:", e));
    }
    initStarLearning().catch((e) => console.error("[Star] Learning init failed:", e));
  }, 5000);

  return httpServer;
}
