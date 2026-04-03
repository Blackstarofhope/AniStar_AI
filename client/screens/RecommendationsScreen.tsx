import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ActivityIndicator,
} from "react-native";
import GemSlider from "@/components/GemSlider";
import { useHeaderHeight } from "@react-navigation/elements";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";

import { ThemedText } from "@/components/ThemedText";
import { AIStatusModal } from "@/components/AIStatusModal";
import { StarChat } from "@/components/StarChat";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";
import { useUser } from "@/contexts/UserContext";
import type { RecsStackParamList } from "@/navigation/types";

type NavProp = NativeStackNavigationProp<RecsStackParamList, "Recommendations">;

interface Recommendation {
  mal_id: number;
  title: string;
  imageUrl: string;
  confidence: number;
  artworkVerified: boolean;
  artworkScore: number;
  genres: string[];
  score?: number;
  lane?: string;
  reason?: string;
  discoveredBy?: { userId: string; displayName: string };
}

interface ThreeLaneRecommendations {
  safe: Recommendation[];
  stretch: Recommendation[];
  blind: Recommendation[];
}

interface Ban {
  id: number;
  malId: number | null;
  bannedGenre: string | null;
  bannedTrope: string | null;
  reason: string | null;
}

async function fetchLanes(userId: string): Promise<ThreeLaneRecommendations> {
  const url = new URL("/api/ai/recommend/lanes", getApiUrl());
  url.searchParams.set("userId", userId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to fetch lanes");
  const json = await res.json();
  return { safe: json.safe || [], stretch: json.stretch || [], blind: json.blind || [] };
}

async function fetchPreferences(userId: string): Promise<{ hiddenGemBias: number }> {
  const url = new URL("/api/user/preferences", getApiUrl());
  url.searchParams.set("userId", userId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to fetch preferences");
  return res.json();
}

async function fetchBans(userId: string): Promise<Ban[]> {
  const url = new URL("/api/user/bans", getApiUrl());
  url.searchParams.set("userId", userId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to fetch bans");
  return res.json();
}

async function postFeedback(malId: number, rating: number, userId: string): Promise<void> {
  const url = new URL("/api/ai/feedback", getApiUrl());
  await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ malId, rating }),
  });
}

async function postPreferences(userId: string, hiddenGemBias: number): Promise<void> {
  const url = new URL("/api/user/preferences", getApiUrl());
  await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": userId },
    body: JSON.stringify({ hiddenGemBias }),
  });
}

async function postBan(
  userId: string,
  ban: { malId?: number; bannedGenre?: string }
): Promise<void> {
  const url = new URL("/api/user/ban", getApiUrl());
  await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": userId },
    body: JSON.stringify(ban),
  });
}

async function deleteBan(userId: string, banId: number): Promise<void> {
  const url = new URL(`/api/user/ban/${banId}`, getApiUrl());
  await fetch(url.toString(), {
    method: "DELETE",
    headers: { "x-user-id": userId },
  });
}

function LaneCard({
  item,
  lane,
  userId,
  onPress,
}: {
  item: Recommendation;
  lane: "safe" | "stretch" | "blind";
  userId: string;
  onPress: () => void;
}) {
  const [thumbState, setThumbState] = useState<"up" | "down" | null>(null);

  const laneAccent =
    lane === "safe"
      ? Colors.dark.accent
      : lane === "stretch"
      ? Colors.dark.accentSecondary
      : Colors.dark.neonPink;

  const handleFeedback = useCallback(
    async (liked: boolean) => {
      setThumbState(liked ? "up" : "down");
      try {
        await postFeedback(item.mal_id, liked ? 0.85 : 0.15, userId);
      } catch {
        /* silent */
      }
    },
    [item.mal_id, userId]
  );

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        cardStyles.card,
        lane === "stretch" && cardStyles.stretchCard,
        lane === "blind" && cardStyles.blindCard,
        thumbState !== null && { borderColor: laneAccent, borderWidth: 1.5 },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Image
        source={{ uri: item.imageUrl }}
        style={cardStyles.image}
        contentFit="cover"
        transition={300}
      />
      <LinearGradient
        colors={
          lane === "blind"
            ? ["transparent", "rgba(255,0,127,0.25)", "rgba(15,15,18,0.98)"]
            : ["transparent", "rgba(15,15,18,0.97)"]
        }
        style={cardStyles.gradient}
      />

      <View style={cardStyles.topRow}>
        {item.artworkVerified ? (
          <View style={cardStyles.microBadge}>
            <Ionicons name="checkmark-circle" size={11} color="#4ADE80" />
          </View>
        ) : (
          <View />
        )}
        {lane === "blind" ? (
          <View style={[cardStyles.microBadge, cardStyles.blindBadge]}>
            <ThemedText style={cardStyles.blindBadgeText}>?</ThemedText>
          </View>
        ) : (
          <View style={cardStyles.confidenceBadge}>
            <Ionicons name="sparkles" size={9} color={laneAccent} />
            <ThemedText style={[cardStyles.confidenceText, { color: laneAccent }]}>
              {Math.round(item.confidence * 100)}%
            </ThemedText>
          </View>
        )}
      </View>

      <View style={cardStyles.bottomArea}>
        <ThemedText style={cardStyles.title} numberOfLines={2}>
          {item.title}
        </ThemedText>
        {item.score ? (
          <View style={cardStyles.scoreRow}>
            <Ionicons name="star" size={9} color={Colors.dark.accent} />
            <ThemedText style={cardStyles.scoreText}>{item.score.toFixed(1)}</ThemedText>
          </View>
        ) : null}
        {item.reason ? (
          <ThemedText
            style={[
              cardStyles.reason,
              { color: lane === "blind" ? "#FF6DB3" : Colors.dark.textSecondary },
            ]}
            numberOfLines={2}
          >
            {item.reason}
          </ThemedText>
        ) : null}
        <View style={cardStyles.feedbackRow}>
          <Pressable
            onPress={() => handleFeedback(true)}
            hitSlop={8}
            style={({ pressed }) => [
              cardStyles.thumbBtn,
              thumbState === "up" && cardStyles.thumbUpActive,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons
              name={thumbState === "up" ? "thumbs-up" : "thumbs-up-outline"}
              size={13}
              color={thumbState === "up" ? "#4ADE80" : Colors.dark.textSecondary}
            />
          </Pressable>
          <Pressable
            onPress={() => handleFeedback(false)}
            hitSlop={8}
            style={({ pressed }) => [
              cardStyles.thumbBtn,
              thumbState === "down" && cardStyles.thumbDownActive,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons
              name={thumbState === "down" ? "thumbs-down" : "thumbs-down-outline"}
              size={13}
              color={thumbState === "down" ? Colors.dark.neonPink : Colors.dark.textSecondary}
            />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

function LaneSection({
  title,
  subtitle,
  lane,
  data,
  isLoading,
  accent,
  userId,
  onCardPress,
}: {
  title: string;
  subtitle: string;
  lane: "safe" | "stretch" | "blind";
  data: Recommendation[];
  isLoading: boolean;
  accent: string;
  userId: string;
  onCardPress: (item: Recommendation) => void;
}) {
  return (
    <View style={sectionStyles.wrapper}>
      <View style={sectionStyles.header}>
        <View style={[sectionStyles.accentBar, { backgroundColor: accent }]} />
        <View>
          <ThemedText style={sectionStyles.title}>{title}</ThemedText>
          <ThemedText style={sectionStyles.subtitle}>{subtitle}</ThemedText>
        </View>
      </View>

      {isLoading ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={sectionStyles.scrollContent}
          scrollEnabled={false}
        >
          {[0, 1, 2].map((i) => (
            <View key={i} style={[cardStyles.card, cardStyles.skeleton]} />
          ))}
        </ScrollView>
      ) : data.length === 0 ? (
        <View style={sectionStyles.emptyRow}>
          <Ionicons name="sparkles-outline" size={18} color={accent} style={{ opacity: 0.4 }} />
          <ThemedText style={sectionStyles.emptyText}>
            Chat with Star to unlock picks
          </ThemedText>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={sectionStyles.scrollContent}
        >
          {data.map((item) => (
            <LaneCard
              key={item.mal_id}
              item={item}
              lane={lane}
              userId={userId}
              onPress={() => onCardPress(item)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function BanModal({
  visible,
  userId,
  onClose,
  onBanChanged,
  allAnime,
}: {
  visible: boolean;
  userId: string;
  onClose: () => void;
  onBanChanged: () => void;
  allAnime: Recommendation[];
}) {
  const [bans, setBans] = useState<Ban[]>([]);
  const [loadingBans, setLoadingBans] = useState(false);
  const [genreInput, setGenreInput] = useState("");
  const [animeInput, setAnimeInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoadingBans(true);
    setErrorMsg(null);
    fetchBans(userId)
      .then(setBans)
      .catch(() => {})
      .finally(() => setLoadingBans(false));
  }, [visible, userId]);

  const handleRemove = useCallback(
    async (banId: number) => {
      try {
        await deleteBan(userId, banId);
        setBans((prev) => prev.filter((b) => b.id !== banId));
        onBanChanged();
      } catch {
        /* silent */
      }
    },
    [userId, onBanChanged]
  );

  const handleAddGenre = useCallback(async () => {
    const genre = genreInput.trim();
    if (!genre) return;
    setAdding(true);
    setErrorMsg(null);
    try {
      await postBan(userId, { bannedGenre: genre });
      setGenreInput("");
      const updated = await fetchBans(userId);
      setBans(updated);
      onBanChanged();
    } catch {
      setErrorMsg("Failed to add genre ban.");
    } finally {
      setAdding(false);
    }
  }, [genreInput, userId, onBanChanged]);

  const handleAddAnime = useCallback(async () => {
    const query = animeInput.trim().toLowerCase();
    if (!query) return;
    const match = allAnime.find((a) => a.title.toLowerCase().includes(query));
    if (!match) {
      setErrorMsg("Anime not found in current recommendations. Try banning by genre instead.");
      return;
    }
    setAdding(true);
    setErrorMsg(null);
    try {
      await postBan(userId, { malId: match.mal_id });
      setAnimeInput("");
      const updated = await fetchBans(userId);
      setBans(updated);
      onBanChanged();
    } catch {
      setErrorMsg("Failed to ban anime.");
    } finally {
      setAdding(false);
    }
  }, [animeInput, allAnime, userId, onBanChanged]);

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen">
      <Pressable style={modalStyles.overlay} onPress={onClose}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.handle} />
          <View style={modalStyles.sheetHeader}>
            <ThemedText style={modalStyles.sheetTitle}>Manage Bans</ThemedText>
            <Pressable onPress={onClose} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Ionicons name="close" size={22} color={Colors.dark.textSecondary} />
            </Pressable>
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1 }}
          >
            <ScrollView
              style={modalStyles.scroll}
              contentContainerStyle={modalStyles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <ThemedText style={modalStyles.sectionLabel}>Current bans</ThemedText>
              {loadingBans ? (
                <ActivityIndicator
                  color={Colors.dark.accent}
                  style={{ marginVertical: Spacing.md }}
                />
              ) : bans.length === 0 ? (
                <ThemedText style={modalStyles.emptyBans}>No bans yet.</ThemedText>
              ) : (
                bans.map((ban) => (
                  <View key={ban.id} style={modalStyles.banRow}>
                    <View style={modalStyles.banInfo}>
                      {ban.bannedGenre ? (
                        <ThemedText style={modalStyles.banLabel}>
                          Genre: {ban.bannedGenre}
                        </ThemedText>
                      ) : ban.malId ? (
                        <ThemedText style={modalStyles.banLabel}>
                          Anime #{ban.malId}
                        </ThemedText>
                      ) : ban.bannedTrope ? (
                        <ThemedText style={modalStyles.banLabel}>
                          Trope: {ban.bannedTrope}
                        </ThemedText>
                      ) : null}
                      {ban.reason ? (
                        <ThemedText style={modalStyles.banReason}>{ban.reason}</ThemedText>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={() => handleRemove(ban.id)}
                      hitSlop={10}
                      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                    >
                      <Ionicons name="trash-outline" size={18} color={Colors.dark.neonPink} />
                    </Pressable>
                  </View>
                ))
              )}

              <ThemedText style={[modalStyles.sectionLabel, { marginTop: Spacing.xl }]}>
                Ban a genre
              </ThemedText>
              <View style={modalStyles.inputRow}>
                <TextInput
                  style={modalStyles.input}
                  placeholder="e.g. Ecchi, Harem, Isekai..."
                  placeholderTextColor={Colors.dark.textSecondary}
                  value={genreInput}
                  onChangeText={setGenreInput}
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={handleAddGenre}
                  editable={!adding}
                />
                <Pressable
                  style={({ pressed }) => [modalStyles.addBtn, pressed && { opacity: 0.7 }]}
                  onPress={handleAddGenre}
                  disabled={adding}
                >
                  <ThemedText style={modalStyles.addBtnText}>Ban</ThemedText>
                </Pressable>
              </View>

              <ThemedText style={[modalStyles.sectionLabel, { marginTop: Spacing.lg }]}>
                Ban an anime
              </ThemedText>
              <View style={modalStyles.inputRow}>
                <TextInput
                  style={modalStyles.input}
                  placeholder="Anime title from current results..."
                  placeholderTextColor={Colors.dark.textSecondary}
                  value={animeInput}
                  onChangeText={setAnimeInput}
                  returnKeyType="done"
                  onSubmitEditing={handleAddAnime}
                  editable={!adding}
                />
                <Pressable
                  style={({ pressed }) => [modalStyles.addBtn, pressed && { opacity: 0.7 }]}
                  onPress={handleAddAnime}
                  disabled={adding}
                >
                  <ThemedText style={modalStyles.addBtnText}>Ban</ThemedText>
                </Pressable>
              </View>

              {errorMsg ? (
                <ThemedText style={modalStyles.errorText}>{errorMsg}</ThemedText>
              ) : null}

              <View style={{ height: Spacing["4xl"] }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Pressable>
    </Modal>
  );
}

export default function RecommendationsScreen() {
  const navigation = useNavigation<NavProp>();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();
  const { userId } = useUser();

  const [statusVisible, setStatusVisible] = useState(false);
  const [banModalVisible, setBanModalVisible] = useState(false);
  const [sliderValue, setSliderValue] = useState(0.5);

  const { data: lanes, isLoading, isError, refetch, isFetching } = useQuery<ThreeLaneRecommendations>({
    queryKey: ["/api/ai/recommend/lanes", userId],
    queryFn: () => fetchLanes(userId),
    staleTime: 2 * 60 * 1000,
    retry: 2,
  });

  const { data: preferences } = useQuery<{ hiddenGemBias: number }>({
    queryKey: ["/api/user/preferences", userId],
    queryFn: () => fetchPreferences(userId),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (preferences?.hiddenGemBias !== undefined) {
      setSliderValue(preferences.hiddenGemBias);
    }
  }, [preferences]);

  const handleSliderComplete = useCallback(
    async (value: number) => {
      setSliderValue(value);
      try {
        await postPreferences(userId, value);
        queryClient.invalidateQueries({ queryKey: ["/api/ai/recommend/lanes", userId] });
      } catch {
        /* silent */
      }
    },
    [userId, queryClient]
  );

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => setStatusVisible(true)}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingRight: 4 })}
          hitSlop={12}
          accessibilityLabel="AI Status"
        >
          <Ionicons name="hardware-chip-outline" size={20} color={Colors.dark.accent} />
        </Pressable>
      ),
    });
  }, [navigation]);

  const handleCardPress = useCallback(
    (item: Recommendation) => {
      navigation.navigate("AnimeDetail", {
        animeId: item.mal_id,
        title: item.title,
        imageUrl: item.imageUrl,
      });
    },
    [navigation]
  );

  const allAnime = [
    ...(lanes?.safe || []),
    ...(lanes?.stretch || []),
    ...(lanes?.blind || []),
  ];

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: headerHeight }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <ScrollView
        style={styles.lanesScroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isFetching}
            onRefresh={() => refetch()}
            tintColor={Colors.dark.accent}
            colors={[Colors.dark.accent]}
          />
        }
      >
        {/* Hidden Gem Slider */}
        <View style={styles.sliderSection}>
          <View style={styles.sliderLabelRow}>
            <Ionicons name="diamond-outline" size={14} color={Colors.dark.accent} />
            <ThemedText style={styles.sliderTitle}>Discovery Mode</ThemedText>
          </View>
          <View style={styles.sliderRow}>
            <ThemedText style={styles.sliderEndLabel}>Mainstream</ThemedText>
            <GemSlider
              style={styles.slider}
              value={sliderValue}
              onValueChange={setSliderValue}
              onSlidingComplete={handleSliderComplete}
            />
            <ThemedText style={styles.sliderEndLabel}>Hidden Gems</ThemedText>
          </View>
        </View>

        {/* Ban list link */}
        <Pressable
          style={({ pressed }) => [styles.banLink, pressed && { opacity: 0.65 }]}
          onPress={() => setBanModalVisible(true)}
        >
          <Ionicons name="ban-outline" size={13} color={Colors.dark.neonPink} />
          <ThemedText style={styles.banLinkText}>Manage ban list</ThemedText>
          <Ionicons name="chevron-forward" size={13} color={Colors.dark.textSecondary} />
        </Pressable>

        {/* Error banner */}
        {isError ? (
          <View style={styles.errorBanner}>
            <Ionicons name="warning-outline" size={15} color={Colors.dark.neonPink} />
            <ThemedText style={styles.errorText}>Picks unavailable</ThemedText>
            <Pressable
              onPress={() => refetch()}
              style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
            >
              <ThemedText style={styles.retryText}>Retry</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {/* Safe lane */}
        <LaneSection
          title="Safe Picks"
          subtitle="Right in your wheelhouse"
          lane="safe"
          data={lanes?.safe || []}
          isLoading={isLoading}
          accent={Colors.dark.accent}
          userId={userId}
          onCardPress={handleCardPress}
        />

        {/* Stretch lane */}
        <LaneSection
          title="Stretch Picks"
          subtitle="Familiar enough, different enough"
          lane="stretch"
          data={lanes?.stretch || []}
          isLoading={isLoading}
          accent={Colors.dark.accentSecondary}
          userId={userId}
          onCardPress={handleCardPress}
        />

        {/* Blind lane */}
        <LaneSection
          title="Blind Picks"
          subtitle="Trust Star on this one"
          lane="blind"
          data={lanes?.blind || []}
          isLoading={isLoading}
          accent={Colors.dark.neonPink}
          userId={userId}
          onCardPress={handleCardPress}
        />

        <View style={{ height: Spacing.xl }} />
      </ScrollView>

      <StarChat />

      <AIStatusModal visible={statusVisible} onClose={() => setStatusVisible(false)} />

      <BanModal
        visible={banModalVisible}
        userId={userId}
        onClose={() => setBanModalVisible(false)}
        onBanChanged={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/ai/recommend/lanes", userId] });
        }}
        allAnime={allAnime}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  lanesScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  sliderSection: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.xs,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
  },
  sliderLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  sliderTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.dark.accent,
    letterSpacing: 0.4,
  },
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  slider: {
    flex: 1,
    height: 32,
  },
  sliderEndLabel: {
    fontSize: 10,
    color: Colors.dark.textSecondary,
    fontWeight: "500",
  },
  banLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
  },
  banLinkText: {
    fontSize: 12,
    color: Colors.dark.neonPink,
    fontWeight: "600",
    flex: 1,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  errorText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    flex: 1,
  },
  retryBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
  },
  retryText: {
    fontSize: 12,
    color: Colors.dark.accent,
    fontWeight: "600",
  },
});

const sectionStyles = StyleSheet.create({
  wrapper: {
    marginTop: Spacing.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  accentBar: {
    width: 3,
    height: 28,
    borderRadius: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.dark.text,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginTop: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  emptyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  emptyText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
});

const cardStyles = StyleSheet.create({
  card: {
    width: 138,
    height: 238,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    backgroundColor: Colors.dark.backgroundDefault,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    position: "relative",
  },
  stretchCard: {
    borderColor: "rgba(0,229,255,0.25)",
  },
  blindCard: {
    borderColor: "rgba(255,0,127,0.3)",
  },
  skeleton: {
    backgroundColor: Colors.dark.backgroundSecondary,
    opacity: 0.6,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  gradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "72%",
  },
  topRow: {
    position: "absolute",
    top: Spacing.xs,
    left: Spacing.xs,
    right: Spacing.xs,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  microBadge: {
    width: 20,
    height: 20,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(15,15,18,0.88)",
    justifyContent: "center",
    alignItems: "center",
  },
  blindBadge: {
    backgroundColor: "rgba(255,0,127,0.85)",
    width: 20,
    height: 20,
  },
  blindBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#fff",
    lineHeight: 16,
  },
  confidenceBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15,15,18,0.88)",
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    gap: 3,
  },
  confidenceText: {
    fontSize: 10,
    fontWeight: "700",
  },
  bottomArea: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: Spacing.sm,
    gap: 2,
  },
  title: {
    fontSize: 11,
    fontWeight: "600",
    color: "#fff",
    lineHeight: 15,
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  scoreText: {
    fontSize: 10,
    color: Colors.dark.accent,
    fontWeight: "600",
  },
  reason: {
    fontSize: 9,
    lineHeight: 12,
    marginTop: 2,
  },
  feedbackRow: {
    flexDirection: "row",
    gap: Spacing.xs,
    marginTop: 3,
  },
  thumbBtn: {
    width: 26,
    height: 22,
    borderRadius: BorderRadius.xs,
    backgroundColor: "rgba(15,15,18,0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  thumbUpActive: {
    backgroundColor: "rgba(74,222,128,0.2)",
  },
  thumbDownActive: {
    backgroundColor: "rgba(255,0,127,0.2)",
  },
});

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.dark.glassBorder,
    maxHeight: "80%",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.dark.glassBorder,
    alignSelf: "center",
    marginTop: Spacing.sm,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.glassBorder,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.dark.text,
  },
  scroll: {
    maxHeight: "100%",
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.dark.accent,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: Spacing.sm,
  },
  emptyBans: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    marginBottom: Spacing.sm,
  },
  banRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.glassBorder,
    gap: Spacing.sm,
  },
  banInfo: {
    flex: 1,
  },
  banLabel: {
    fontSize: 13,
    color: Colors.dark.text,
    fontWeight: "500",
  },
  banReason: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginTop: 2,
  },
  inputRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    alignItems: "center",
  },
  input: {
    flex: 1,
    height: 40,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    paddingHorizontal: Spacing.md,
    color: Colors.dark.text,
    fontSize: 13,
  },
  addBtn: {
    height: 40,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.dark.accent,
    borderRadius: BorderRadius.xs,
    justifyContent: "center",
    alignItems: "center",
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  errorText: {
    fontSize: 12,
    color: Colors.dark.neonPink,
    marginTop: Spacing.sm,
    lineHeight: 16,
  },
});
