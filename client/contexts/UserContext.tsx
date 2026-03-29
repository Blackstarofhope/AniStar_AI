import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/query-client";
import { setCurrentUserId } from "@/lib/userState";

const USER_ID_KEY = "@anistar/userId";
const DISPLAY_NAME_KEY = "@anistar/displayName";

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface UserContextValue {
  userId: string;
  displayName: string | null;
  isLoading: boolean;
  saveDisplayName: (name: string) => Promise<void>;
}

const UserContext = createContext<UserContextValue>({
  userId: "default",
  displayName: null,
  isLoading: true,
  saveDisplayName: async () => {},
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState("default");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        let storedId = await AsyncStorage.getItem(USER_ID_KEY);
        if (!storedId) {
          storedId = generateUUID();
          await AsyncStorage.setItem(USER_ID_KEY, storedId);
        }
        setUserId(storedId);
        setCurrentUserId(storedId);

        const storedName = await AsyncStorage.getItem(DISPLAY_NAME_KEY);
        setDisplayName(storedName ?? null);
      } catch {
        const fallbackId = generateUUID();
        setUserId(fallbackId);
        setCurrentUserId(fallbackId);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  const saveDisplayName = useCallback(async (name: string) => {
    const trimmed = name.trim();
    const url = new URL("/api/user/displayname", getApiUrl());
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, displayName: trimmed }),
    });
    if (!res.ok) throw new Error("Failed to save display name");
    await AsyncStorage.setItem(DISPLAY_NAME_KEY, trimmed);
    setDisplayName(trimmed);
  }, [userId]);

  return (
    <UserContext.Provider value={{ userId, displayName, isLoading, saveDisplayName }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  return useContext(UserContext);
}
