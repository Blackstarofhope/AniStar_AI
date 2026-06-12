import React, { useEffect, useState, useRef } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { useUser } from "@/contexts/UserContext";
import { apiRequest } from "@/lib/query-client";
import GameshowScreen from "@/screens/GameshowScreen";

type SubScreen = "home" | "path1" | "waiting" | "gameshow";

const PATHS = [
  {
    id: "list" as const,
    title: "Speak the names",
    subtitle:
      "Tell Star which anime have stayed with you and why. She'll feel out the patterns.",
    icon: "chatbubble-ellipses-outline" as const,
    accentColor: Colors.dark.accent,
  },
  {
    id: "gameshow" as const,
    title: "The trial of choices",
    subtitle:
      "A short interactive ritual. Genres, characters, instincts. Star reads what you pick.",
    icon: "flash-outline" as const,
    accentColor: Colors.dark.accentSecondary,
  },
  {
    id: "manual" as const,
    title: "Walk the library",
    subtitle:
      "Browse Star's collection. Favorite what calls to you. Star will recognize you when she sees enough.",
    icon: "library-outline" as const,
    accentColor: Colors.dark.neonPink,
  },
] as const;

export default function OnboardingScreen() {
  const { setOnboardingPath, setPreferredStartTab } = useUser();
  const [sub, setSub] = useState<SubScreen>("home");
  const [greeting, setGreeting] = useState<string | null>(null);
  const [greetingLoading, setGreetingLoading] = useState(true);
  const [manualSubmitting, setManualSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchGreeting() {
      try {
        const res = await apiRequest("POST", "/api/ai/chat", {
          message: "Hello, I've just arrived.",
          history: [],
        });
        const data = (await res.json()) as { response?: string };
        if (!cancelled) setGreeting(data.response ?? null);
      } catch {
        if (!cancelled) setGreeting(null);
      } finally {
        if (!cancelled) setGreetingLoading(false);
      }
    }
    fetchGreeting();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleManualPath() {
    if (manualSubmitting) return;
    setManualSubmitting(true);
    try {
      await apiRequest("POST", "/api/onboarding/path3/start", {});
    } catch {}
    setPreferredStartTab("LibraryTab");
    setOnboardingPath("manual");
  }

  if (sub === "gameshow") {
    return <GameshowScreen onBack={() => setSub("home")} />;
  }

  if (sub === "path1") {
    return (
      <Path1View
        onBack={() => setSub("home")}
        onSuccess={() => {
          setSub("waiting");
        }}
      />
    );
  }

  if (sub === "waiting") {
    return <WaitingView onDone={() => setOnboardingPath("list")} />;
  }

  return (
    <LinearGradient
      colors={["#0F0F12", "#1A0A2E", "#0F0F12"]}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoRow}>
            <Image
              source={require("../../assets/images/icon.png")}
              style={styles.icon}
              resizeMode="contain"
            />
            <ThemedText style={styles.appName}>AniStar</ThemedText>
          </View>

          <View style={styles.greetingBox}>
            {greetingLoading ? (
              <ActivityIndicator color={Colors.dark.accent} size="small" />
            ) : (
              <ThemedText style={styles.greetingText}>
                {greeting ?? "*Someone new.*\nBefore I can show you anything — what kind of fire burns in you?"}
              </ThemedText>
            )}
          </View>

          <ThemedText style={styles.sectionLabel}>Choose your path</ThemedText>

          {PATHS.map((path) => {
            const isComingSoon = "comingSoon" in path && path.comingSoon;
            let onPress = () => {};
            if (path.id === "list") onPress = () => setSub("path1");
            else if (path.id === "gameshow") onPress = () => setSub("gameshow");
            else if (path.id === "manual") onPress = handleManualPath;
            return (
              <PathCard
                key={path.id}
                path={path}
                onPress={onPress}
                disabled={!!isComingSoon || manualSubmitting}
                loading={path.id === "manual" && manualSubmitting}
              />
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function PathCard({
  path,
  onPress,
  disabled,
  loading,
}: {
  path: (typeof PATHS)[number];
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const isComingSoon = "comingSoon" in path && path.comingSoon;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { borderColor: path.accentColor + "55" },
        disabled && styles.cardDisabled,
        pressed && !disabled && styles.cardPressed,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={[styles.iconCircle, { backgroundColor: path.accentColor + "22" }]}>
        {loading ? (
          <ActivityIndicator color={path.accentColor} size="small" />
        ) : (
          <Ionicons name={path.icon} size={24} color={path.accentColor} />
        )}
      </View>
      <View style={styles.cardText}>
        <View style={styles.titleRow}>
          <ThemedText style={[styles.cardTitle, { color: path.accentColor }]}>
            {path.title}
          </ThemedText>
          {isComingSoon ? (
            <View style={styles.soonBadge}>
              <ThemedText style={styles.soonText}>Soon</ThemedText>
            </View>
          ) : null}
        </View>
        <ThemedText style={styles.cardSubtitle}>{path.subtitle}</ThemedText>
      </View>
    </Pressable>
  );
}

function Path1View({
  onBack,
  onSuccess,
}: {
  onBack: () => void;
  onSuccess: () => void;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = text.trim().length >= 10 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/onboarding/path1", { favorites: text.trim() });
    } catch {}
    onSuccess();
  }

  return (
    <LinearGradient
      colors={["#0F0F12", "#1A0A2E", "#0F0F12"]}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.safe}>
        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable onPress={onBack} style={styles.backButton} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={Colors.dark.accent} />
            <ThemedText style={styles.backText}>Back</ThemedText>
          </Pressable>

          <View style={styles.header}>
            <View style={[styles.iconCircle, { backgroundColor: "rgba(168,85,247,0.15)" }]}>
              <Ionicons name="chatbubble-ellipses-outline" size={26} color={Colors.dark.accent} />
            </View>
            <ThemedText style={styles.heading}>Speak the names</ThemedText>
            <ThemedText style={styles.subheading}>
              Star will feel the shape of your taste from what you share.
            </ThemedText>
          </View>

          <TextInput
            style={styles.bigInput}
            value={text}
            onChangeText={(t) => {
              setText(t);
              setError(null);
            }}
            placeholder="List anime that have stayed with you. Tell me why each one mattered. Don't hold back."
            placeholderTextColor={Colors.dark.tabIconDefault}
            multiline
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoCorrect
            maxLength={3000}
          />

          <ThemedText style={styles.charCount}>{text.length} / 3000</ThemedText>

          {error ? (
            <ThemedText style={styles.errorText}>{error}</ThemedText>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              !canSubmit && styles.buttonDisabled,
              pressed && canSubmit && styles.buttonPressed,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <ThemedText style={styles.buttonText}>Let Star feel it</ThemedText>
            )}
          </Pressable>

          <ThemedText style={styles.hint}>
            Minimum 10 characters. The more you share, the better Star reads you.
          </ThemedText>
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function WaitingView({ onDone }: { onDone: () => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(onDone, 3000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onDone]);

  return (
    <LinearGradient
      colors={["#0F0F12", "#1A0A2E", "#0F0F12"]}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.waitingCenter}>
          <View style={styles.waitingIconWrap}>
            <Ionicons name="sparkles" size={40} color={Colors.dark.accent} />
          </View>
          <ThemedText style={styles.waitingHeading}>
            Star is feeling out your taste...
          </ThemedText>
          <ThemedText style={styles.waitingSubtitle}>
            She's parsing what you shared and mapping the patterns. This takes just a moment.
          </ThemedText>
          <ActivityIndicator
            color={Colors.dark.accent}
            size="large"
            style={{ marginTop: Spacing["2xl"] }}
          />
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safe: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing["2xl"],
    paddingBottom: Spacing["4xl"],
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing["2xl"],
  },
  icon: { width: 36, height: 36, marginRight: Spacing.sm },
  appName: {
    fontSize: 26,
    fontWeight: "700",
    color: Colors.dark.accent,
    letterSpacing: 1,
  },
  greetingBox: {
    backgroundColor: "rgba(168, 85, 247, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(168, 85, 247, 0.25)",
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    marginBottom: Spacing["3xl"],
    minHeight: 72,
    justifyContent: "center",
    alignItems: "center",
  },
  greetingText: {
    fontSize: 15,
    lineHeight: 23,
    color: Colors.dark.text,
    textAlign: "center",
    fontStyle: "italic",
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.dark.tabIconDefault,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: Spacing.md,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.backgroundSecondary,
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  cardDisabled: { opacity: 0.45 },
  cardPressed: { opacity: 0.8 },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: { flex: 1 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: 4,
  },
  cardTitle: { fontSize: 17, fontWeight: "700" },
  cardSubtitle: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    lineHeight: 19,
  },
  soonBadge: {
    backgroundColor: Colors.dark.backgroundTertiary,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  soonText: {
    fontSize: 10,
    fontWeight: "600",
    color: Colors.dark.tabIconDefault,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.xl,
  },
  backText: {
    fontSize: 15,
    color: Colors.dark.accent,
    fontWeight: "600",
  },
  header: {
    alignItems: "center",
    marginBottom: Spacing["2xl"],
  },
  heading: {
    fontSize: 26,
    fontWeight: "800",
    color: Colors.dark.accent,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  subheading: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 21,
    paddingHorizontal: Spacing.md,
  },
  bigInput: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    fontSize: 16,
    color: Colors.dark.text,
    minHeight: 200,
    lineHeight: 24,
  },
  charCount: {
    fontSize: 11,
    color: Colors.dark.tabIconDefault,
    textAlign: "right",
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  errorText: {
    fontSize: 13,
    color: Colors.dark.neonPink,
    marginBottom: Spacing.md,
  },
  button: {
    backgroundColor: Colors.dark.accent,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md + 2,
    alignItems: "center",
    shadowColor: Colors.dark.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
    marginBottom: Spacing.md,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.85 },
  buttonText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.3,
  },
  hint: {
    fontSize: 12,
    color: Colors.dark.tabIconDefault,
    textAlign: "center",
    lineHeight: 18,
  },
  waitingCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl * 1.5,
  },
  waitingIconWrap: {
    width: 80,
    height: 80,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(168, 85, 247, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing["2xl"],
  },
  waitingHeading: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.dark.accent,
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  waitingSubtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});
