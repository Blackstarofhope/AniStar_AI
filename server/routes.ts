import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { URL } from "node:url";
import dns from "node:dns/promises";
import {
  getRecommendations, processFeedback, getAIStatus, verifyAnimeArtwork
} from "./ai/recommendEngine.js";
import { getSchedule, getSeasonalAnime, getAnimeDetails } from "./ai/animeData.js";

const PRIVATE_IP_REGEX =
  /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|fc00:|fd[0-9a-f]{2}:)/i;

const ALLOWED_IMAGE_HOSTS = new Set([
  "cdn.myanimelist.net",
  "img1.ak.crunchyroll.com",
  "i.imgur.com",
  "s4.anilist.co",
  "media.kitsu.io",
  "artworks.thetvdb.com",
  "img.anili.st",
]);

async function validateImageUrl(rawUrl: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Invalid URL format";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only http and https URLs are allowed";
  }

  const hostname = parsed.hostname.toLowerCase();

  if (!ALLOWED_IMAGE_HOSTS.has(hostname)) {
    return `Host not in allowlist: ${hostname}`;
  }

  try {
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const v6addresses = await dns.resolve6(hostname).catch(() => [] as string[]);
    for (const addr of [...addresses, ...v6addresses]) {
      if (PRIVATE_IP_REGEX.test(addr)) {
        return `Resolved to private/reserved IP: ${addr}`;
      }
    }
  } catch {
  }

  return null;
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
    const limit = Math.min(25, parseInt((req.query.limit as string) || "10", 10));
    try {
      const recommendations = await getRecommendations(limit);
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
    const { malId, imageUrl, title } = req.body as {
      malId?: number; imageUrl?: string; title?: string;
    };
    if (typeof malId !== "number" || typeof imageUrl !== "string") {
      return res.status(400).json({ error: "malId and imageUrl are required" });
    }
    const urlError = await validateImageUrl(imageUrl);
    if (urlError) {
      return res.status(400).json({ error: `Invalid image URL: ${urlError}` });
    }
    try {
      const result = await verifyAnimeArtwork(malId, imageUrl, title);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: "Verification failed" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
