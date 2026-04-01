import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/query-client";
import { getCurrentUserId } from "@/lib/userState";

const FAVORITES_KEY = "@anistar_favorites";

interface FavoriteAnime {
  mal_id: number;
  title: string;
  imageUrl: string;
}

interface FavoritesContextValue {
  favorites: FavoriteAnime[];
  isLoading: boolean;
  isFavorite: (malId: number) => boolean;
  toggleFavorite: (anime: FavoriteAnime) => Promise<void>;
  addFavorite: (anime: FavoriteAnime) => Promise<void>;
  removeFavorite: (malId: number) => Promise<void>;
  refreshFavorites: () => Promise<void>;
}

const FavoritesContext = createContext<FavoritesContextValue | undefined>(undefined);

function sendFeedback(malId: number, rating: number): void {
  const userId = getCurrentUserId();
  const url = new URL("/api/ai/feedback", getApiUrl());
  fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ malId, rating, userId }),
  }).catch(() => {});
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<FavoriteAnime[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadFavorites = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem(FAVORITES_KEY);
      if (stored) {
        setFavorites(JSON.parse(stored));
      }
    } catch (error) {
      console.error("Failed to load favorites:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFavorites();
  }, [loadFavorites]);

  const saveFavorites = async (newFavorites: FavoriteAnime[]) => {
    try {
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavorites));
    } catch (error) {
      console.error("Failed to save favorites:", error);
    }
  };

  const isFavorite = useCallback(
    (malId: number) => {
      return favorites.some((f) => f.mal_id === malId);
    },
    [favorites]
  );

  const toggleFavorite = useCallback(
    async (anime: FavoriteAnime) => {
      const exists = favorites.some((f) => f.mal_id === anime.mal_id);
      let newFavorites: FavoriteAnime[];

      if (exists) {
        newFavorites = favorites.filter((f) => f.mal_id !== anime.mal_id);
        sendFeedback(anime.mal_id, 0.4);
      } else {
        newFavorites = [...favorites, anime];
        sendFeedback(anime.mal_id, 0.75);
      }

      setFavorites(newFavorites);
      await saveFavorites(newFavorites);
    },
    [favorites]
  );

  const addFavorite = useCallback(
    async (anime: FavoriteAnime) => {
      if (!isFavorite(anime.mal_id)) {
        const newFavorites = [...favorites, anime];
        setFavorites(newFavorites);
        await saveFavorites(newFavorites);
        sendFeedback(anime.mal_id, 0.75);
      }
    },
    [favorites, isFavorite]
  );

  const removeFavorite = useCallback(
    async (malId: number) => {
      const newFavorites = favorites.filter((f) => f.mal_id !== malId);
      setFavorites(newFavorites);
      await saveFavorites(newFavorites);
      sendFeedback(malId, 0.4);
    },
    [favorites]
  );

  return (
    <FavoritesContext.Provider
      value={{
        favorites,
        isLoading,
        isFavorite,
        toggleFavorite,
        addFavorite,
        removeFavorite,
        refreshFavorites: loadFavorites,
      }}
    >
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (context === undefined) {
    throw new Error("useFavorites must be used within a FavoritesProvider");
  }
  return context;
}
