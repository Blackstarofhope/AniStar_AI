import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";

import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { useUser } from "@/contexts/UserContext";
import { apiRequest } from "@/lib/query-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const GENRES = ["Action", "Romance", "Comedy", "Drama", "Slice of Life", "Thriller"] as const;
type Genre = (typeof GENRES)[number];
type SubDub = "sub" | "dub" | "either";
type Phase = "genres" | "loading-chars" | "characters" | "loading-reveal" | "reveal";

interface Character {
  id: string;
  name: string;
  anime: string;
  mal_id: number | null;
  tags: string[];
  represents: string;
}

interface Recommendation {
  mal_id: number;
  title: string;
  imageUrl: string;
  confidence: number;
  artworkVerified: boolean;
  artworkScore: number;
  genres: string[];
  score?: number;
  reason?: string;
}

interface RevealData {
  shown: Recommendation[];
  hidden: (Recommendation & { blindspot: true; starMessage: string }) | null;
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function GameshowScreen({ onBack }: { onBack: () => void }) {
  const { setOnboardingPath, markOnboardingUnlocked } = useUser();

  const [phase, setPhase] = useState<Phase>("genres");
  const [selectedGenres, setSelectedGenres] = useState<Set<Genre>>(new Set());
  const [subDub, setSubDub] = useState<SubDub>("either");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [revealData, setRevealData] = useState<RevealData | null>(null);
  const [hiddenRevealed, setHiddenRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleGenre(g: Genre) {
    setSelectedGenres((prev) => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  }

  async function handleGenreContinue() {
    if (selectedGenres.size === 0) return;
    setError(null);
    setPhase("loading-chars");
    try {
      await apiRequest("POST", "/api/onboarding/path2/genres", {
        genres: Array.from(selectedGenres),
        subDubPreference: subDub,
      });
      const res = await apiRequest("GET", "/api/onboarding/path2/characters");
      const data = (await res.json()) as { characters: Character[] };
      setCharacters(data.characters ?? []);
      setPhase("characters");
    } catch {
      setError("Something went wrong fetching your characters. Try again.");
      setPhase("genres");
    }
  }

  async function handleSubmitRankings() {
    const allRated = characters.every((c) => ratings[c.id] !== undefined);
    if (!allRated) return;
    setError(null);
    setPhase("loading-reveal");
    try {
      const res = await apiRequest("POST", "/api/onboarding/path2/rankings", {
        rankings: characters.map((c) => ({ characterId: c.id, rating: ratings[c.id] })),
      });
      const data = (await res.json()) as RevealData;
      setRevealData(data);
      setPhase("reveal");
    } catch {
      setError("Something went wrong submitting your rankings. Try again.");
      setPhase("characters");
    }
  }

  function handleEnterApp() {
    markOnboardingUnlocked();
    setOnboardingPath("gameshow");
  }

  // Loading screens
  if (phase === "loading-chars") {
    return (
      <LoadingView message="Star is choosing your characters..." />
    );
  }
  if (phase === "loading-reveal") {
    return (
      <LoadingView message="Star is reading your instincts..." />
    );
  }

  if (phase === "genres") {
    return (
      <GenresView
        selectedGenres={selectedGenres}
        subDub={subDub}
        onToggleGenre={toggleGenre}
        onSubDubChange={setSubDub}
        onContinue={handleGenreContinue}
        onBack={onBack}
        error={error}
      />
    );
  }

  if (phase === "characters") {
    return (
      <CharactersView
        characters={characters}
        ratings={ratings}
        onRate={(characterId, rating) =>
          setRatings((prev) => ({ ...prev, [characterId]: rating }))
        }
        onSubmit={handleSubmitRankings}
        error={error}
      />
    );
  }

  if (phase === "reveal") {
    return (
      <RevealView
        revealData={revealData ?? { shown: [], hidden: null }}
        hiddenRevealed={hiddenRevealed}
        onRevealHidden={() => setHiddenRevealed(true)}
        onEnterApp={handleEnterApp}
      />
    );
  }

  return <LoadingView message="Preparing your trial..." />;
}

// ---------------------------------------------------------------------------
// Loading screen
// ---------------------------------------------------------------------------

function LoadingView({ message }: { message: string }) {
  return (
    <LinearGradient colors={["#0F0F12", "#1A0A2E", "#0F0F12"]} style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.loadingCenter}>
          <Ionicons name="sparkles" size={36} color={Colors.dark.accentSecondary} style={{ marginBottom: Spacing.lg }} />
          <ThemedText style={styles.loadingText}>{message}</ThemedText>
          <ActivityIndicator color={Colors.dark.accentSecondary} size="large" style={{ marginTop: Spacing.xl }} />
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Genre selection
// ---------------------------------------------------------------------------

function GenresView({
  selectedGenres,
  subDub,
  onToggleGenre,
  onSubDubChange,
  onContinue,
  onBack,
  error,
}: {
  selectedGenres: Set<Genre>;
  subDub: SubDub;
  onToggleGenre: (g: Genre) => void;
  onSubDubChange: (v: SubDub) => void;
  onContinue: () => void;
  onBack: () => void;
  error: string | null;
}) {
  const canContinue = selectedGenres.size > 0;

  return (
    <LinearGradient colors={["#0F0F12", "#1A0A2E", "#0F0F12"]} style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Pressable onPress={onBack} style={styles.backRow} hitSlop={12}>
            <Ionicons name="arrow-back" size={20} color={Colors.dark.accentSecondary} />
            <ThemedText style={[styles.backText, { color: Colors.dark.accentSecondary }]}>Back</ThemedText>
          </Pressable>

          <View style={styles.stepHeader}>
            <View style={[styles.stepBadge, { backgroundColor: Colors.dark.accentSecondary + "22" }]}>
              <ThemedText style={[styles.stepBadgeText, { color: Colors.dark.accentSecondary }]}>Step 1 of 3</ThemedText>
            </View>
            <ThemedText style={[styles.stepTitle, { color: Colors.dark.accentSecondary }]}>
              What pulls you in?
            </ThemedText>
            <ThemedText style={styles.stepSubtitle}>
              Select the genres that resonate. Star reads the patterns beneath your choices.
            </ThemedText>
          </View>

          <View style={styles.genreGrid}>
            {GENRES.map((genre) => {
              const selected = selectedGenres.has(genre);
              return (
                <Pressable
                  key={genre}
                  style={({ pressed }) => [
                    styles.genreCard,
                    selected && styles.genreCardSelected,
                    pressed && styles.genreCardPressed,
                  ]}
                  onPress={() => onToggleGenre(genre)}
                >
                  <View style={styles.genreCardInner}>
                    <Ionicons
                      name={selected ? "checkmark-circle" : "ellipse-outline"}
                      size={20}
                      color={selected ? Colors.dark.accentSecondary : Colors.dark.tabIconDefault}
                    />
                    <ThemedText
                      style={[
                        styles.genreLabel,
                        selected && { color: Colors.dark.accentSecondary },
                      ]}
                    >
                      {genre}
                    </ThemedText>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <ThemedText style={styles.sectionMini}>Sub or Dub?</ThemedText>
          <View style={styles.subDubRow}>
            {(["sub", "dub", "either"] as SubDub[]).map((opt) => (
              <Pressable
                key={opt}
                style={[styles.subDubBtn, subDub === opt && styles.subDubBtnActive]}
                onPress={() => onSubDubChange(opt)}
              >
                <ThemedText
                  style={[
                    styles.subDubText,
                    subDub === opt && styles.subDubTextActive,
                  ]}
                >
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: Colors.dark.accentSecondary },
              !canContinue && styles.btnDisabled,
              pressed && canContinue && styles.btnPressed,
            ]}
            onPress={onContinue}
            disabled={!canContinue}
          >
            <ThemedText style={styles.primaryBtnText}>Continue</ThemedText>
            <Ionicons name="arrow-forward" size={18} color="#000" />
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Character ranking
// ---------------------------------------------------------------------------

function CharactersView({
  characters,
  ratings,
  onRate,
  onSubmit,
  error,
}: {
  characters: Character[];
  ratings: Record<string, number>;
  onRate: (characterId: string, rating: number) => void;
  onSubmit: () => void;
  error: string | null;
}) {
  const allRated = characters.length > 0 && characters.every((c) => ratings[c.id] !== undefined);

  return (
    <LinearGradient colors={["#0F0F12", "#1A0A2E", "#0F0F12"]} style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.stepHeader}>
            <View style={[styles.stepBadge, { backgroundColor: Colors.dark.accentSecondary + "22" }]}>
              <ThemedText style={[styles.stepBadgeText, { color: Colors.dark.accentSecondary }]}>Step 2 of 3</ThemedText>
            </View>
            <ThemedText style={[styles.stepTitle, { color: Colors.dark.accentSecondary }]}>
              The trial of characters
            </ThemedText>
            <ThemedText style={styles.stepSubtitle}>
              Star chose these for you. Rate each one — your instinct matters more than your reason.
            </ThemedText>
          </View>

          {characters.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              rating={ratings[character.id] ?? 0}
              onRate={(r) => onRate(character.id, r)}
            />
          ))}

          {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: Colors.dark.accentSecondary },
              !allRated && styles.btnDisabled,
              pressed && allRated && styles.btnPressed,
            ]}
            onPress={onSubmit}
            disabled={!allRated}
          >
            <ThemedText style={styles.primaryBtnText}>Submit Rankings</ThemedText>
          </Pressable>

          {!allRated ? (
            <ThemedText style={styles.hintText}>
              Rate all {characters.length} characters to continue.
            </ThemedText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function CharacterCard({
  character,
  rating,
  onRate,
}: {
  character: Character;
  rating: number;
  onRate: (r: number) => void;
}) {
  return (
    <View style={styles.charCard}>
      <ThemedText style={styles.charName}>{character.name}</ThemedText>
      <ThemedText style={styles.charAnime}>{character.anime}</ThemedText>
      <ThemedText style={styles.charRepresents} numberOfLines={3}>
        {character.represents}
      </ThemedText>
      <View style={styles.starRow}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Pressable key={star} onPress={() => onRate(star)} hitSlop={8}>
            <Ionicons
              name={star <= rating ? "star" : "star-outline"}
              size={28}
              color={star <= rating ? Colors.dark.accentSecondary : Colors.dark.tabIconDefault}
            />
          </Pressable>
        ))}
        {rating > 0 ? (
          <ThemedText style={styles.ratingLabel}>{rating}/5</ThemedText>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Reveal
// ---------------------------------------------------------------------------

function RevealView({
  revealData,
  hiddenRevealed,
  onRevealHidden,
  onEnterApp,
}: {
  revealData: RevealData;
  hiddenRevealed: boolean;
  onRevealHidden: () => void;
  onEnterApp: () => void;
}) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - Spacing.xl * 2, 480);

  const hasContent = revealData.shown.length > 0 || revealData.hidden !== null;

  return (
    <LinearGradient colors={["#0F0F12", "#1A0A2E", "#0F0F12"]} style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.stepHeader}>
            <View style={[styles.stepBadge, { backgroundColor: Colors.dark.accentSecondary + "22" }]}>
              <ThemedText style={[styles.stepBadgeText, { color: Colors.dark.accentSecondary }]}>Step 3 of 3</ThemedText>
            </View>
            <ThemedText style={[styles.stepTitle, { color: Colors.dark.accentSecondary }]}>
              Star has read your choices.
            </ThemedText>
            <ThemedText style={styles.stepSubtitle}>
              These are her first impressions. They'll sharpen as she learns more.
            </ThemedText>
          </View>

          {!hasContent ? (
            <View style={styles.emptyReveal}>
              <Ionicons name="sparkles-outline" size={40} color={Colors.dark.accentSecondary} style={{ marginBottom: Spacing.md }} />
              <ThemedText style={styles.emptyRevealText}>
                Star is still calibrating. Your recommendations will be ready inside the app.
              </ThemedText>
            </View>
          ) : null}

          {revealData.shown.length > 0 ? (
            <View style={{ gap: Spacing.md, marginBottom: Spacing.lg }}>
              <ThemedText style={styles.revealSectionLabel}>Her clearest reads</ThemedText>
              {revealData.shown.map((rec) => (
                <ShownAnimeCard key={rec.mal_id} rec={rec} cardWidth={cardWidth} />
              ))}
            </View>
          ) : null}

          {revealData.hidden !== null ? (
            <View style={{ marginBottom: Spacing.xl }}>
              <ThemedText style={styles.revealSectionLabel}>Star's blindspot</ThemedText>
              <HiddenAnimeCard
                rec={revealData.hidden}
                revealed={hiddenRevealed}
                onReveal={onRevealHidden}
                cardWidth={cardWidth}
              />
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: Colors.dark.accentSecondary, marginTop: Spacing.md },
              pressed && styles.btnPressed,
            ]}
            onPress={onEnterApp}
          >
            <Ionicons name="sparkles" size={18} color="#000" />
            <ThemedText style={styles.primaryBtnText}>Enter the app</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function ShownAnimeCard({
  rec,
  cardWidth,
}: {
  rec: Recommendation;
  cardWidth: number;
}) {
  const imgH = Math.round(cardWidth * 0.45);
  return (
    <View style={[styles.animeCard, { width: cardWidth }]}>
      {rec.imageUrl ? (
        <View style={{ height: imgH, borderRadius: BorderRadius.xs, overflow: "hidden", marginBottom: Spacing.sm }}>
          <Image
            source={{ uri: rec.imageUrl }}
            style={{ width: "100%", height: imgH }}
            contentFit="cover"
          />
          <LinearGradient
            colors={["transparent", "rgba(15,15,18,0.75)"]}
            style={StyleSheet.absoluteFillObject}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 0, y: 1 }}
            pointerEvents="none"
          />
        </View>
      ) : null}
      <ThemedText style={styles.animeTitle} numberOfLines={2}>{rec.title}</ThemedText>
      {rec.genres?.length ? (
        <ThemedText style={styles.animeGenres}>{rec.genres.slice(0, 3).join(" · ")}</ThemedText>
      ) : null}
      {rec.reason ? (
        <View style={styles.reasonBox}>
          <Ionicons name="sparkles-outline" size={12} color={Colors.dark.accentSecondary} style={{ marginTop: 2 }} />
          <ThemedText style={styles.reasonText}>{rec.reason}</ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function HiddenAnimeCard({
  rec,
  revealed,
  onReveal,
  cardWidth,
}: {
  rec: Recommendation & { blindspot: true; starMessage: string };
  revealed: boolean;
  onReveal: () => void;
  cardWidth: number;
}) {
  const imgH = Math.round(cardWidth * 0.45);

  if (!revealed) {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.animeCard,
          styles.hiddenCard,
          { width: cardWidth, opacity: pressed ? 0.85 : 1 },
        ]}
        onPress={onReveal}
      >
        <View style={{ height: imgH, borderRadius: BorderRadius.xs, overflow: "hidden", marginBottom: Spacing.sm }}>
          {rec.imageUrl ? (
            <Image
              source={{ uri: rec.imageUrl }}
              style={{ width: "100%", height: imgH }}
              contentFit="cover"
              blurRadius={18}
            />
          ) : (
            <View style={{ width: "100%", height: imgH, backgroundColor: Colors.dark.backgroundTertiary }} />
          )}
          <View style={[StyleSheet.absoluteFillObject, styles.hiddenOverlay]}>
            <Ionicons name="eye-off-outline" size={32} color="rgba(255,255,255,0.6)" style={{ marginBottom: Spacing.sm }} />
            <ThemedText style={styles.hiddenOverlayText}>
              Star's blindspot... she cannot see this one clearly.
            </ThemedText>
            <ThemedText style={styles.hiddenOverlayTap}>Tap to reveal what her instinct says.</ThemedText>
          </View>
        </View>
        <View style={styles.hiddenTitleRow}>
          <Ionicons name="help-circle-outline" size={18} color={Colors.dark.tabIconDefault} />
          <ThemedText style={[styles.animeTitle, { color: Colors.dark.tabIconDefault }]}>???</ThemedText>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.animeCard, styles.hiddenCardRevealed, { width: cardWidth }]}>
      {rec.imageUrl ? (
        <View style={{ height: imgH, borderRadius: BorderRadius.xs, overflow: "hidden", marginBottom: Spacing.sm }}>
          <Image
            source={{ uri: rec.imageUrl }}
            style={{ width: "100%", height: imgH }}
            contentFit="cover"
          />
          <LinearGradient
            colors={["transparent", "rgba(15,15,18,0.75)"]}
            style={StyleSheet.absoluteFillObject}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 0, y: 1 }}
            pointerEvents="none"
          />
        </View>
      ) : null}
      <ThemedText style={styles.animeTitle} numberOfLines={2}>{rec.title}</ThemedText>
      {rec.genres?.length ? (
        <ThemedText style={styles.animeGenres}>{rec.genres.slice(0, 3).join(" · ")}</ThemedText>
      ) : null}
      <View style={styles.starMessageBox}>
        <Ionicons name="sparkles" size={14} color={Colors.dark.neonPink} style={{ marginTop: 2 }} />
        <ThemedText style={styles.starMessageText}>{rec.starMessage}</ThemedText>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: { flex: 1 },

  loadingCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl * 1.5,
  },
  loadingText: {
    fontSize: 17,
    fontWeight: "600",
    color: Colors.dark.textSecondary,
    textAlign: "center",
  },

  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing["2xl"],
    paddingBottom: Spacing["4xl"],
  },

  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.xl,
  },
  backText: {
    fontSize: 15,
    fontWeight: "600",
  },

  stepHeader: {
    marginBottom: Spacing["2xl"],
  },
  stepBadge: {
    alignSelf: "flex-start",
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    marginBottom: Spacing.md,
  },
  stepBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: "800",
    marginBottom: Spacing.sm,
    lineHeight: 32,
  },
  stepSubtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    lineHeight: 21,
  },

  genreGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  genreCard: {
    width: "48%",
    backgroundColor: Colors.dark.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  genreCardSelected: {
    borderColor: Colors.dark.accentSecondary,
    backgroundColor: "rgba(0, 229, 255, 0.08)",
  },
  genreCardPressed: { opacity: 0.75 },
  genreCardInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  genreLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.dark.textSecondary,
    flex: 1,
  },

  sectionMini: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.dark.tabIconDefault,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  subDubRow: {
    flexDirection: "row",
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    padding: 3,
    gap: 3,
    marginBottom: Spacing.xl,
  },
  subDubBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: BorderRadius.xs - 4,
    alignItems: "center",
  },
  subDubBtnActive: {
    backgroundColor: Colors.dark.accentSecondary,
  },
  subDubText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.dark.tabIconDefault,
  },
  subDubTextActive: {
    color: "#000",
  },

  errorText: {
    fontSize: 13,
    color: Colors.dark.neonPink,
    marginBottom: Spacing.md,
    textAlign: "center",
  },
  hintText: {
    fontSize: 12,
    color: Colors.dark.tabIconDefault,
    textAlign: "center",
    marginTop: Spacing.sm,
  },

  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md + 2,
    marginBottom: Spacing.sm,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  btnDisabled: { opacity: 0.4 },
  btnPressed: { opacity: 0.82 },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#000",
    letterSpacing: 0.3,
  },

  // Character cards
  charCard: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  charName: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.dark.accentSecondary,
    marginBottom: 2,
  },
  charAnime: {
    fontSize: 12,
    color: Colors.dark.tabIconDefault,
    marginBottom: Spacing.sm,
  },
  charRepresents: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    lineHeight: 19,
    fontStyle: "italic",
    marginBottom: Spacing.md,
  },
  starRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  ratingLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.dark.accentSecondary,
    marginLeft: Spacing.xs,
  },

  // Reveal
  revealSectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.dark.tabIconDefault,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: Spacing.md,
  },
  animeCard: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  animeTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.dark.text,
    marginBottom: 4,
  },
  animeGenres: {
    fontSize: 11,
    color: Colors.dark.tabIconDefault,
    marginBottom: Spacing.sm,
  },
  reasonBox: {
    flexDirection: "row",
    gap: Spacing.xs,
    backgroundColor: "rgba(0, 229, 255, 0.06)",
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: "rgba(0, 229, 255, 0.15)",
    padding: Spacing.sm,
  },
  reasonText: {
    flex: 1,
    fontSize: 12,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
    fontStyle: "italic",
  },

  hiddenCard: {
    borderColor: "rgba(255, 0, 127, 0.3)",
    backgroundColor: Colors.dark.backgroundTertiary,
  },
  hiddenCardRevealed: {
    borderColor: Colors.dark.neonPink + "66",
    backgroundColor: "rgba(255, 0, 127, 0.05)",
  },
  hiddenOverlay: {
    backgroundColor: "rgba(10, 8, 20, 0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  hiddenOverlayText: {
    fontSize: 13,
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
    lineHeight: 19,
    marginBottom: Spacing.xs,
  },
  hiddenOverlayTap: {
    fontSize: 12,
    color: Colors.dark.neonPink,
    textAlign: "center",
    fontWeight: "600",
  },
  hiddenTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },

  starMessageBox: {
    flexDirection: "row",
    gap: Spacing.xs,
    backgroundColor: "rgba(255, 0, 127, 0.08)",
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: "rgba(255, 0, 127, 0.2)",
    padding: Spacing.sm,
    marginTop: Spacing.sm,
  },
  starMessageText: {
    flex: 1,
    fontSize: 13,
    color: Colors.dark.neonPink,
    lineHeight: 19,
    fontStyle: "italic",
  },

  emptyReveal: {
    alignItems: "center",
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
  },
  emptyRevealText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
});
