import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiUrl } from "@/lib/query-client";
import { setCurrentUserId } from "@/lib/userState";

const USER_ID_KEY = "@anistar/userId";
const DISPLAY_NAME_KEY = "@anistar/displayName";

interface OnboardingState {
  pathChosen: string | null;
  completed: boolean;
  unlockedRecommendations: boolean;
}

interface UserContextValue {
  userId: string | null;
  displayName: string | null;
  isLoading: boolean;
  onboardingPath: string | null;
  onboardingUnlocked: boolean;
  isCheckingOnboarding: boolean;
  preferredStartTab: string;
  register: (displayName: string, pin: string) => Promise<void>;
  login: (displayName: string, pin: string) => Promise<boolean>;
  saveDisplayName: (name: string, pin: string) => Promise<void>;
  setOnboardingPath: (path: string) => void;
  markOnboardingUnlocked: () => void;
  setPreferredStartTab: (tab: string) => void;
  refreshOnboardingState: () => Promise<void>;
}

const UserContext = createContext<UserContextValue>({
  userId: null,
  displayName: null,
  isLoading: true,
  onboardingPath: null,
  onboardingUnlocked: false,
  isCheckingOnboarding: false,
  preferredStartTab: "Schedule",
  register: async () => {},
  login: async () => false,
  saveDisplayName: async () => {},
  setOnboardingPath: () => {},
  markOnboardingUnlocked: () => {},
  setPreferredStartTab: () => {},
  refreshOnboardingState: async () => {},
});

async function fetchOnboardingStateFromServer(userId: string, baseUrl: string): Promise<OnboardingState> {
  const url = new URL(`/api/user/onboarding-state?userId=${encodeURIComponent(userId)}`, baseUrl);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to fetch onboarding state");
  return res.json() as Promise<OnboardingState>;
}

async function applySession(
  userId: string,
  displayName: string,
  setUserId: (id: string) => void,
  setDisplayName: (name: string) => void,
  setOnboardingPathState: (path: string | null) => void,
  setOnboardingUnlocked: (val: boolean) => void,
  baseUrl: string
): Promise<void> {
  await AsyncStorage.setItem(USER_ID_KEY, userId);
  await AsyncStorage.setItem(DISPLAY_NAME_KEY, displayName);
  setUserId(userId);
  setCurrentUserId(userId);
  setDisplayName(displayName);
  try {
    const state = await fetchOnboardingStateFromServer(userId, baseUrl);
    setOnboardingPathState(state.pathChosen ?? null);
    setOnboardingUnlocked(state.unlockedRecommendations ?? false);
  } catch {
    setOnboardingPathState(null);
    setOnboardingUnlocked(false);
  }
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [onboardingPath, setOnboardingPathState] = useState<string | null>(null);
  const [onboardingUnlocked, setOnboardingUnlocked] = useState(false);
  const [isCheckingOnboarding, setIsCheckingOnboarding] = useState(false);
  const [preferredStartTab, setPreferredStartTabState] = useState("Schedule");

  useEffect(() => {
    async function init() {
      try {
        const storedId = await AsyncStorage.getItem(USER_ID_KEY);
        if (!storedId) {
          // No authenticated session — app will show AuthScreen
          return;
        }
        setUserId(storedId);
        setCurrentUserId(storedId);

        const storedName = await AsyncStorage.getItem(DISPLAY_NAME_KEY);
        setDisplayName(storedName ?? null);

        setIsCheckingOnboarding(true);
        try {
          const baseUrl = getApiUrl();
          const state = await fetchOnboardingStateFromServer(storedId, baseUrl);
          setOnboardingPathState(state.pathChosen ?? null);
          setOnboardingUnlocked(state.unlockedRecommendations ?? false);
        } catch {
        } finally {
          setIsCheckingOnboarding(false);
        }
      } catch {
        // Storage read failed — leave userId null, show AuthScreen
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  const register = useCallback(async (name: string, pin: string): Promise<void> => {
    const baseUrl = getApiUrl();
    const url = new URL("/api/auth/register", baseUrl);
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: name.trim(), pin }),
    });
    if (res.status === 409) throw new Error("taken");
    if (!res.ok) throw new Error("register_failed");
    const { userId: returnedId, displayName: returnedName } = await res.json() as { userId: string; displayName: string };
    await applySession(
      returnedId, returnedName,
      setUserId, setDisplayName,
      setOnboardingPathState, setOnboardingUnlocked,
      baseUrl
    );
  }, []);

  const login = useCallback(async (name: string, pin: string): Promise<boolean> => {
    const baseUrl = getApiUrl();
    const url = new URL("/api/auth/login", baseUrl);
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: name.trim(), pin }),
    });
    if (res.status === 429) throw new Error("rate_limited");
    if (!res.ok) return false;
    const { userId: returnedId, displayName: returnedName } = await res.json() as { userId: string; displayName: string };
    await applySession(
      returnedId, returnedName,
      setUserId, setDisplayName,
      setOnboardingPathState, setOnboardingUnlocked,
      baseUrl
    );
    return true;
  }, []);

  const saveDisplayName = useCallback(async (name: string, pin: string) => {
    const trimmed = name.trim();
    const url = new URL("/api/user/displayname", getApiUrl());
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, displayName: trimmed, pin }),
    });
    if (res.status === 409) throw new Error("taken");
    if (!res.ok) throw new Error("Failed to save display name");
    await AsyncStorage.setItem(DISPLAY_NAME_KEY, trimmed);
    setDisplayName(trimmed);
    setOnboardingPathState(null);
    setOnboardingUnlocked(false);
  }, [userId]);

  const setOnboardingPath = useCallback((path: string) => {
    setOnboardingPathState(path);
  }, []);

  const markOnboardingUnlocked = useCallback(() => {
    setOnboardingUnlocked(true);
  }, []);

  const setPreferredStartTab = useCallback((tab: string) => {
    setPreferredStartTabState(tab);
  }, []);

  const refreshOnboardingState = useCallback(async () => {
    if (!userId) return;
    try {
      const baseUrl = getApiUrl();
      const state = await fetchOnboardingStateFromServer(userId, baseUrl);
      setOnboardingPathState(state.pathChosen ?? null);
      setOnboardingUnlocked(state.unlockedRecommendations ?? false);
    } catch {}
  }, [userId]);

  return (
    <UserContext.Provider
      value={{
        userId,
        displayName,
        isLoading,
        onboardingPath,
        onboardingUnlocked,
        isCheckingOnboarding,
        preferredStartTab,
        register,
        login,
        saveDisplayName,
        setOnboardingPath,
        markOnboardingUnlocked,
        setPreferredStartTab,
        refreshOnboardingState,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  return useContext(UserContext);
}
