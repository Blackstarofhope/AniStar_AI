import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useHeaderHeight } from "@react-navigation/elements";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useMutation } from "@tanstack/react-query";

import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { apiRequest } from "@/lib/query-client";
import { useUser } from "@/contexts/UserContext";

const MUTED = Colors.dark.tabIconDefault;
const GLASS = Colors.dark.backgroundSecondary;
const CARD_GAP = 8;
const LIST_PAD = 12;

const COMMON_GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror",
  "Mystery", "Romance", "Sci-Fi", "Shounen", "Slice of Life",
  "Sports", "Supernatural", "Thriller",
];

interface VibeProfile {
  atmosphere: string;
  pacing: string;
  tone: string;
  protagonistArchetype: string;
  relationshipDynamics: string;
  emotionalArc: string;
  vibeText: string;
}

interface LibraryAnime {
  mal_id: number;
  title: string;
  imageUrl: string;
  score: number | null;
  genres: string[];
  episodes: number | null;
  synopsis: string | null;
  vibe: VibeProfile | null;
  discoveredBy: string | null;
}

type Source = "all" | "airing" | "discovered";

function LibraryCard({
  anime,
  cardWidth,
  userId,
  onPress,
  onUnlocked,
}: {
  anime: LibraryAnime;
  cardWidth: number;
  userId: string | null;
  onPress: () => void;
  onUnlocked?: () => void;
}) {
  const [rated, setRated] = useState<"like" | "dislike" | null>(null);

  const feedbackMutation = useMutation({
    mutationFn: ({ rating }: { rating: number }) =>
      apiRequest("POST", "/api/ai/feedback", { malId: anime.mal_id, rating, userId }),
    onSuccess: async (res) => {
      if (!onUnlocked) return;
      try {
        const data = (await res.json()) as { justUnlocked?: boolean };
        if (data.justUnlocked) onUnlocked();
      } catch {}
    },
  });

  const handleFeedback = useCallback(
    (type: "like" | "dislike") => {
      if (rated === type || feedbackMutation.isPending) return;
      setRated(type);
      feedbackMutation.mutate({ rating: type === "like" ? 0.8 : 0.2 });
    },
    [rated, feedbackMutation.isPending, anime.mal_id, userId],
  );

  const imgHeight = Math.round(cardWidth * 1.45);

  return (
    <Pressable style={[styles.card, { width: cardWidth }]} onPress={onPress}>
      <View style={{ width: cardWidth, height: imgHeight, overflow: "hidden", borderTopLeftRadius: BorderRadius.xs, borderTopRightRadius: BorderRadius.xs }}>
        <Image
          source={{ uri: anime.imageUrl }}
          style={{ width: cardWidth, height: imgHeight }}
          contentFit="cover"
        />
        <LinearGradient
          colors={["transparent", "rgba(15,15,18,0.7)"]}
          style={StyleSheet.absoluteFillObject}
          start={{ x: 0, y: 0.55 }}
          end={{ x: 0, y: 1 }}
          pointerEvents="none"
        />
        {anime.discoveredBy ? (
          <View style={styles.discoveredBadge}>
            <Ionicons name="star" size={8} color={Colors.dark.accent} />
          </View>
        ) : null}
      </View>

      <View style={styles.cardBody}>
        <ThemedText style={styles.cardTitle} numberOfLines={2}>
          {anime.title}
        </ThemedText>

        <View style={styles.cardMeta}>
          {anime.score != null ? (
            <View style={styles.scoreRow}>
              <Ionicons name="star" size={9} color="#FFD700" />
              <ThemedText style={styles.scoreText}>{anime.score.toFixed(1)}</ThemedText>
            </View>
          ) : null}
          {anime.episodes != null ? (
            <ThemedText style={styles.episodeText}>{anime.episodes} ep</ThemedText>
          ) : null}
        </View>

        {anime.genres.length > 0 ? (
          <View style={styles.genreRow}>
            {anime.genres.slice(0, 2).map((g) => (
              <View key={g} style={styles.genrePill}>
                <ThemedText style={styles.genrePillText}>{g}</ThemedText>
              </View>
            ))}
          </View>
        ) : null}

        {anime.vibe ? (
          <ThemedText style={styles.vibeLabel} numberOfLines={1}>
            {anime.vibe.atmosphere} · {anime.vibe.tone}
          </ThemedText>
        ) : null}

        {anime.discoveredBy ? (
          <View style={styles.discoveredRow}>
            <Ionicons name="star" size={8} color={Colors.dark.accent} />
            <ThemedText style={styles.discoveredName} numberOfLines={1}>
              {anime.discoveredBy}
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.feedbackRow}>
          <Pressable
            style={[styles.feedBtn, rated === "like" && styles.feedBtnLike]}
            onPress={() => handleFeedback("like")}
            hitSlop={6}
          >
            <Ionicons
              name={rated === "like" ? "thumbs-up" : "thumbs-up-outline"}
              size={12}
              color={rated === "like" ? Colors.dark.accent : MUTED}
            />
          </Pressable>
          <Pressable
            style={[styles.feedBtn, rated === "dislike" && styles.feedBtnDislike]}
            onPress={() => handleFeedback("dislike")}
            hitSlop={6}
          >
            <Ionicons
              name={rated === "dislike" ? "thumbs-down" : "thumbs-down-outline"}
              size={12}
              color={rated === "dislike" ? Colors.dark.neonPink : MUTED}
            />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

function DetailModal({
  anime,
  visible,
  onClose,
}: {
  anime: LibraryAnime | null;
  visible: boolean;
  onClose: () => void;
}) {
  if (!anime) return null;

  const vibeRows: [string, string][] = anime.vibe
    ? [
        ["Atmosphere", anime.vibe.atmosphere],
        ["Pacing", anime.vibe.pacing],
        ["Tone", anime.vibe.tone],
        ["Protagonist", anime.vibe.protagonistArchetype],
        ["Relationships", anime.vibe.relationshipDynamics],
        ["Emotional Arc", anime.vibe.emotionalArc],
      ]
    : [];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <ThemedText style={styles.modalTitle} numberOfLines={2}>
            {anime.title}
          </ThemedText>
          <Pressable onPress={onClose} style={styles.modalCloseBtn} hitSlop={8}>
            <Ionicons name="close" size={22} color={Colors.dark.text} />
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.modalContent}
          showsVerticalScrollIndicator={false}
        >
          <Image
            source={{ uri: anime.imageUrl }}
            style={styles.modalImage}
            contentFit="cover"
          />

          <View style={styles.modalMeta}>
            {anime.score != null ? (
              <View style={styles.modalMetaItem}>
                <Ionicons name="star" size={13} color="#FFD700" />
                <ThemedText style={styles.modalMetaText}>{anime.score.toFixed(1)}</ThemedText>
              </View>
            ) : null}
            {anime.episodes != null ? (
              <View style={styles.modalMetaItem}>
                <Ionicons name="play-circle-outline" size={13} color={MUTED} />
                <ThemedText style={styles.modalMetaText}>{anime.episodes} episodes</ThemedText>
              </View>
            ) : null}
          </View>

          {anime.genres.length > 0 ? (
            <View style={styles.modalGenreRow}>
              {anime.genres.map((g) => (
                <View key={g} style={styles.modalGenrePill}>
                  <ThemedText style={styles.genrePillText}>{g}</ThemedText>
                </View>
              ))}
            </View>
          ) : null}

          {anime.synopsis ? (
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Synopsis</ThemedText>
              <ThemedText style={styles.sectionBody}>{anime.synopsis}</ThemedText>
            </View>
          ) : null}

          {anime.vibe ? (
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Vibe Profile</ThemedText>
              {anime.vibe.vibeText ? (
                <ThemedText style={[styles.sectionBody, { marginBottom: Spacing.sm, fontStyle: "italic" }]}>
                  {anime.vibe.vibeText}
                </ThemedText>
              ) : null}
              {vibeRows.map(([label, value]) => (
                <View key={label} style={styles.vibeRow}>
                  <ThemedText style={styles.vibeLabel2}>{label}</ThemedText>
                  <ThemedText style={styles.vibeValue}>{value}</ThemedText>
                </View>
              ))}
            </View>
          ) : null}

          {anime.discoveredBy ? (
            <View style={styles.discoveredBanner}>
              <Ionicons name="star" size={14} color={Colors.dark.accent} />
              <ThemedText style={styles.discoveredBannerText}>
                Discovered by {anime.discoveredBy}
              </ThemedText>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function LibraryScreen() {
  const { userId, onboardingPath, onboardingUnlocked, markOnboardingUnlocked, refreshOnboardingState } = useUser();
  const headerHeight = useHeaderHeight();

  const focusCountRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      if (focusCountRef.current > 0) {
        refreshOnboardingState();
      }
      focusCountRef.current += 1;
    }, [refreshOnboardingState])
  );
  const tabBarHeight = useBottomTabBarHeight();
  const { width } = useWindowDimensions();

  const [search, setSearch] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  const [source, setSource] = useState<Source>("all");
  const [detailAnime, setDetailAnime] = useState<LibraryAnime | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<{
    items: LibraryAnime[];
  }>({
    queryKey: ["/api/anime/library", source, userId],
    enabled: !!userId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/anime/library?source=${source}`);
      return res.json() as Promise<{ items: LibraryAnime[] }>;
    },
  });

  const cardWidth = useMemo(() => {
    const usable = Math.min(width, 520) - LIST_PAD * 2 - CARD_GAP;
    return Math.floor(usable / 2);
  }, [width]);

  const availableGenres = useMemo(() => {
    if (!data?.items) return COMMON_GENRES;
    const found = new Set<string>();
    for (const a of data.items) for (const g of a.genres) found.add(g);
    return COMMON_GENRES.filter((g) => found.has(g));
  }, [data]);

  const filtered = useMemo(() => {
    if (!data?.items) return [];
    let items = data.items;
    if (source === "discovered") {
      items = items.filter((a) => a.discoveredBy !== null && a.discoveredBy !== undefined);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((a) => a.title.toLowerCase().includes(q));
    }
    if (selectedGenres.size > 0) {
      items = items.filter((a) => a.genres.some((g) => selectedGenres.has(g)));
    }
    return items;
  }, [data, source, search, selectedGenres]);

  const toggleGenre = useCallback((g: string) => {
    setSelectedGenres((prev) => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  }, []);

  const openDetail = useCallback((anime: LibraryAnime) => {
    setDetailAnime(anime);
    setModalVisible(true);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: LibraryAnime }) => (
      <LibraryCard
        anime={item}
        cardWidth={cardWidth}
        userId={userId}
        onPress={() => openDetail(item)}
        onUnlocked={markOnboardingUnlocked}
      />
    ),
    [cardWidth, userId, openDetail, markOnboardingUnlocked],
  );

  const keyExtractor = useCallback(
    (item: LibraryAnime) => String(item.mal_id),
    [],
  );

  const renderListHeader = useCallback(
    () => (
      <View style={styles.controls}>
        {onboardingPath === "manual" && !onboardingUnlocked ? (
          <View style={styles.manualBanner}>
            <Ionicons name="star-outline" size={14} color={Colors.dark.accentSecondary} />
            <ThemedText style={styles.manualBannerText}>
              Favorite anime that resonate. Star will let you know when she sees you.
            </ThemedText>
          </View>
        ) : null}
        <View style={styles.sourceToggle}>
          {(["all", "airing", "discovered"] as Source[]).map((s) => (
            <Pressable
              key={s}
              style={[styles.toggleBtn, source === s && styles.toggleBtnActive]}
              onPress={() => setSource(s)}
            >
              <ThemedText
                style={[
                  styles.toggleBtnText,
                  source === s && styles.toggleBtnTextActive,
                ]}
              >
                {s === "all" ? "All" : s === "airing" ? "Airing" : "Discovered"}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={15} color={MUTED} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search anime..."
            placeholderTextColor={MUTED}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <Ionicons name="close-circle" size={15} color={MUTED} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.genreScroll}
        >
          {availableGenres.map((g) => (
            <Pressable
              key={g}
              style={[
                styles.genreChip,
                selectedGenres.has(g) && styles.genreChipActive,
              ]}
              onPress={() => toggleGenre(g)}
            >
              <ThemedText
                style={[
                  styles.genreChipText,
                  selectedGenres.has(g) && styles.genreChipTextActive,
                ]}
              >
                {g}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>

        <ThemedText style={styles.countText}>{filtered.length} anime</ThemedText>
      </View>
    ),
    [source, search, availableGenres, selectedGenres, filtered.length, toggleGenre, onboardingPath, onboardingUnlocked],
  );

  const ListEmpty = useMemo(
    () =>
      isLoading ? (
        <ActivityIndicator
          color={Colors.dark.accent}
          size="large"
          style={{ marginTop: 60 }}
        />
      ) : isError ? (
        <ThemedText style={styles.emptyText}>Failed to load library</ThemedText>
      ) : (
        <ThemedText style={styles.emptyText}>No anime found</ThemedText>
      ),
    [isLoading, isError],
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={filtered}
        keyExtractor={keyExtractor}
        numColumns={2}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        refreshing={isRefetching}
        onRefresh={refetch}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.sm,
          paddingBottom: tabBarHeight + Spacing.lg,
          paddingHorizontal: LIST_PAD,
          gap: CARD_GAP,
        }}
        columnWrapperStyle={{ gap: CARD_GAP }}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={ListEmpty}
      />

      <DetailModal
        anime={detailAnime}
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },

  controls: {
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  manualBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: "rgba(0, 229, 255, 0.07)",
    borderWidth: 1,
    borderColor: "rgba(0, 229, 255, 0.2)",
    borderRadius: BorderRadius.xs,
    padding: Spacing.sm,
  },
  manualBannerText: {
    flex: 1,
    fontSize: 12,
    color: Colors.dark.accentSecondary,
    lineHeight: 17,
  },
  sourceToggle: {
    flexDirection: "row",
    backgroundColor: GLASS,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    padding: 3,
    gap: 3,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: BorderRadius.xs - 4,
    alignItems: "center",
  },
  toggleBtnActive: {
    backgroundColor: Colors.dark.accent,
  },
  toggleBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: MUTED,
  },
  toggleBtnTextActive: {
    color: "#fff",
  },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: GLASS,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Platform.OS === "ios" ? 8 : 4,
    gap: Spacing.xs,
  },
  searchInput: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 14,
  },

  genreScroll: {
    gap: 6,
    paddingRight: 4,
  },
  genreChip: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    backgroundColor: GLASS,
  },
  genreChipActive: {
    backgroundColor: Colors.dark.accent + "28",
    borderColor: Colors.dark.accent,
  },
  genreChipText: {
    fontSize: 11,
    color: MUTED,
    fontWeight: "500",
  },
  genreChipTextActive: {
    color: Colors.dark.accent,
  },

  countText: {
    fontSize: 10,
    color: MUTED,
    textAlign: "right",
  },

  card: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    overflow: "hidden",
    flex: 1,
  },
  cardBody: {
    padding: 6,
    gap: 3,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.dark.text,
    lineHeight: 15,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  scoreText: {
    fontSize: 10,
    color: "#FFD700",
    fontWeight: "600",
  },
  episodeText: {
    fontSize: 9,
    color: MUTED,
  },
  genreRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3,
  },
  genrePill: {
    backgroundColor: Colors.dark.accent + "20",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: Colors.dark.accent + "50",
  },
  genrePillText: {
    fontSize: 8.5,
    color: Colors.dark.accent,
    fontWeight: "500",
  },
  vibeLabel: {
    fontSize: 9,
    color: MUTED,
    fontStyle: "italic",
  },
  discoveredBadge: {
    position: "absolute",
    top: 5,
    right: 5,
    backgroundColor: "rgba(15,15,18,0.75)",
    borderRadius: 10,
    padding: 3,
    borderWidth: 0.5,
    borderColor: Colors.dark.accent + "60",
  },
  discoveredRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  discoveredName: {
    fontSize: 9,
    color: Colors.dark.accent,
    fontWeight: "500",
    flex: 1,
  },
  feedbackRow: {
    flexDirection: "row",
    gap: 5,
    marginTop: 1,
  },
  feedBtn: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: Colors.dark.backgroundSecondary,
  },
  feedBtnLike: {
    backgroundColor: Colors.dark.accent + "28",
  },
  feedBtnDislike: {
    backgroundColor: Colors.dark.neonPink + "28",
  },

  emptyText: {
    textAlign: "center",
    marginTop: 60,
    color: MUTED,
    fontSize: 14,
  },

  modalContainer: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.glassBorder,
    gap: Spacing.sm,
  },
  modalTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: Colors.dark.text,
    lineHeight: 22,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalContent: {
    padding: Spacing.lg,
    paddingBottom: 48,
    gap: Spacing.md,
  },
  modalImage: {
    width: "100%",
    height: 240,
    borderRadius: BorderRadius.xs,
  },
  modalMeta: {
    flexDirection: "row",
    gap: Spacing.lg,
  },
  modalMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  modalMetaText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    fontWeight: "500",
  },
  modalGenreRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  modalGenrePill: {
    backgroundColor: Colors.dark.accent + "20",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: Colors.dark.accent + "50",
  },
  section: {
    gap: Spacing.xs,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.dark.accent,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  sectionBody: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    lineHeight: 20,
  },
  vibeRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  vibeLabel2: {
    fontSize: 12,
    fontWeight: "600",
    color: MUTED,
    width: 96,
    flexShrink: 0,
  },
  vibeValue: {
    flex: 1,
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  discoveredBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    backgroundColor: Colors.dark.accent + "12",
    padding: Spacing.sm,
    borderRadius: BorderRadius.xs,
    borderWidth: 0.5,
    borderColor: Colors.dark.accent + "40",
  },
  discoveredBannerText: {
    fontSize: 13,
    color: Colors.dark.accent,
    fontWeight: "500",
  },
});
