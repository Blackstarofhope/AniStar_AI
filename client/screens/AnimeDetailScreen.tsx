import React, { useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { differenceInSeconds, addDays, setHours, setMinutes, nextDay } from "date-fns";

import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { RootStackParamList } from "@/navigation/RootStackNavigator";
import { useFavorites } from "@/hooks/useFavorites";

interface AnimeDetail {
  mal_id: number;
  title: string;
  title_english?: string;
  synopsis?: string;
  episodes?: number;
  score?: number;
  scored_by?: number;
  status?: string;
  rating?: string;
  duration?: string;
  season?: string;
  year?: number;
  studios?: { name: string }[];
  genres?: { name: string }[];
  broadcast?: {
    day?: string;
    time?: string;
    string?: string;
  };
  images: {
    jpg: {
      large_image_url: string;
    };
  };
}

const DAY_MAP: { [key: string]: 0 | 1 | 2 | 3 | 4 | 5 | 6 } = {
  Sundays: 0,
  Mondays: 1,
  Tuesdays: 2,
  Wednesdays: 3,
  Thursdays: 4,
  Fridays: 5,
  Saturdays: 6,
};

function getNextAiringDate(broadcast?: { day?: string; time?: string }): Date | null {
  if (!broadcast?.day || !broadcast?.time) return null;
  const dayOfWeek = DAY_MAP[broadcast.day];
  if (dayOfWeek === undefined) return null;
  const [hours, minutes] = broadcast.time.split(":").map(Number);
  if (isNaN(hours) || isNaN(minutes)) return null;

  const now = new Date();
  const jstOffset = 9 * 60;
  const localOffset = -now.getTimezoneOffset();
  const offsetDiff = (jstOffset - localOffset) * 60 * 1000;

  let nextBroadcast = nextDay(now, dayOfWeek);
  nextBroadcast = setHours(nextBroadcast, hours);
  nextBroadcast = setMinutes(nextBroadcast, minutes);
  const localBroadcast = new Date(nextBroadcast.getTime() - offsetDiff);

  if (localBroadcast < now) {
    return addDays(localBroadcast, 7);
  }
  return localBroadcast;
}

function formatCountdown(targetDate: Date): string {
  const now = new Date();
  const diffSeconds = differenceInSeconds(targetDate, now);
  if (diffSeconds <= 0) return "Airing now!";
  const days = Math.floor(diffSeconds / 86400);
  const hours = Math.floor((diffSeconds % 86400) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function fetchAnimeDetail(id: number): Promise<AnimeDetail> {
  const response = await fetch(`https://api.jikan.moe/v4/anime/${id}/full`);
  if (!response.ok) throw new Error("Failed to fetch anime details");
  const data = await response.json();
  return data.data;
}

export default function AnimeDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "AnimeDetail">>();
  const insets = useSafeAreaInsets();
  const { animeId, title, imageUrl } = route.params;
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorited = isFavorite(animeId);

  const { data: anime, isLoading, isError } = useQuery<AnimeDetail>({
    queryKey: ["/api/anime/detail", animeId],
    queryFn: () => fetchAnimeDetail(animeId),
  });

  const [countdown, setCountdown] = useState<string>("Calculating...");

  useEffect(() => {
    if (!anime?.broadcast) {
      setCountdown("TBA");
      return;
    }
    const nextAiring = getNextAiringDate(anime.broadcast);
    if (!nextAiring) {
      setCountdown("TBA");
      return;
    }
    setCountdown(formatCountdown(nextAiring));
    const interval = setInterval(() => {
      setCountdown(formatCountdown(nextAiring));
    }, 1000);
    return () => clearInterval(interval);
  }, [anime?.broadcast]);

  const handleToggleFavorite = () => {
    toggleFavorite({
      mal_id: animeId,
      title: anime?.title || title,
      imageUrl: anime?.images?.jpg?.large_image_url || imageUrl,
    });
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroContainer}>
          <Image
            source={{ uri: anime?.images?.jpg?.large_image_url || imageUrl }}
            style={styles.heroImage}
            contentFit="cover"
          />
          <LinearGradient
            colors={["transparent", "rgba(15, 15, 18, 0.6)", Colors.dark.backgroundRoot]}
            style={styles.heroGradient}
          />
          <View style={styles.heroContent}>
            <ThemedText style={styles.heroTitle} numberOfLines={2}>
              {anime?.title || title}
            </ThemedText>
            {anime?.title_english && anime.title_english !== anime.title ? (
              <ThemedText style={styles.englishTitle} numberOfLines={1}>
                {anime.title_english}
              </ThemedText>
            ) : null}
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.statsRow}>
            <View style={styles.countdownCard}>
              <Ionicons name="time-outline" size={20} color={Colors.dark.accentSecondary} />
              <View>
                <ThemedText style={styles.countdownLabel}>Next Episode</ThemedText>
                <ThemedText style={styles.countdownValue}>{countdown}</ThemedText>
              </View>
            </View>
            <Pressable
              onPress={handleToggleFavorite}
              style={({ pressed }) => [
                styles.favoriteButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons
                name={favorited ? "heart" : "heart-outline"}
                size={24}
                color={favorited ? Colors.dark.neonPink : Colors.dark.text}
              />
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Colors.dark.accent} />
            </View>
          ) : isError ? (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle-outline" size={48} color={Colors.dark.accent} />
              <ThemedText style={styles.errorText}>Failed to load details</ThemedText>
            </View>
          ) : anime ? (
            <>
              <View style={styles.metaGrid}>
                {anime.score ? (
                  <View style={styles.metaCard}>
                    <Ionicons name="star" size={18} color={Colors.dark.accent} />
                    <ThemedText style={styles.metaValue}>{anime.score.toFixed(1)}</ThemedText>
                    <ThemedText style={styles.metaLabel}>Score</ThemedText>
                  </View>
                ) : null}
                {anime.episodes ? (
                  <View style={styles.metaCard}>
                    <Ionicons name="play-circle-outline" size={18} color={Colors.dark.accentSecondary} />
                    <ThemedText style={styles.metaValue}>{anime.episodes}</ThemedText>
                    <ThemedText style={styles.metaLabel}>Episodes</ThemedText>
                  </View>
                ) : null}
                {anime.status ? (
                  <View style={styles.metaCard}>
                    <Ionicons name="radio-button-on" size={18} color="#4ADE80" />
                    <ThemedText style={styles.metaValue} numberOfLines={1}>
                      {anime.status.replace("Currently Airing", "Airing")}
                    </ThemedText>
                    <ThemedText style={styles.metaLabel}>Status</ThemedText>
                  </View>
                ) : null}
              </View>

              {anime.genres && anime.genres.length > 0 ? (
                <View style={styles.section}>
                  <ThemedText style={styles.sectionTitle}>Genres</ThemedText>
                  <View style={styles.genreContainer}>
                    {anime.genres.map((genre) => (
                      <View key={genre.name} style={styles.genreTag}>
                        <ThemedText style={styles.genreText}>{genre.name}</ThemedText>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {anime.studios && anime.studios.length > 0 ? (
                <View style={styles.section}>
                  <ThemedText style={styles.sectionTitle}>Studios</ThemedText>
                  <ThemedText style={styles.studioText}>
                    {anime.studios.map((s) => s.name).join(", ")}
                  </ThemedText>
                </View>
              ) : null}

              {anime.broadcast?.string ? (
                <View style={styles.section}>
                  <ThemedText style={styles.sectionTitle}>Broadcast</ThemedText>
                  <ThemedText style={styles.broadcastText}>{anime.broadcast.string}</ThemedText>
                </View>
              ) : null}

              {anime.synopsis ? (
                <View style={styles.section}>
                  <ThemedText style={styles.sectionTitle}>Synopsis</ThemedText>
                  <ThemedText style={styles.synopsisText}>{anime.synopsis}</ThemedText>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  scrollView: {
    flex: 1,
  },
  heroContainer: {
    width: "100%",
    aspectRatio: 16 / 10,
    position: "relative",
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  heroGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "70%",
  },
  heroContent: {
    position: "absolute",
    bottom: Spacing.lg,
    left: Spacing.lg,
    right: Spacing.lg,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: Colors.dark.text,
  },
  englishTitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginTop: Spacing.xs,
  },
  content: {
    padding: Spacing.lg,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.xl,
  },
  countdownCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.backgroundDefault,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
  },
  countdownLabel: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  countdownValue: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.accentSecondary,
  },
  favoriteButton: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.dark.backgroundDefault,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
  },
  loadingContainer: {
    paddingVertical: Spacing["4xl"],
    alignItems: "center",
  },
  errorContainer: {
    paddingVertical: Spacing["3xl"],
    alignItems: "center",
  },
  errorText: {
    marginTop: Spacing.md,
    color: Colors.dark.textSecondary,
  },
  metaGrid: {
    flexDirection: "row",
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  metaCard: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
  },
  metaValue: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.text,
    marginTop: Spacing.sm,
  },
  metaLabel: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    marginTop: Spacing.xs,
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.text,
    marginBottom: Spacing.md,
  },
  genreContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  genreTag: {
    backgroundColor: Colors.dark.backgroundSecondary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.dark.accent,
  },
  genreText: {
    fontSize: 13,
    color: Colors.dark.accent,
  },
  studioText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
  },
  broadcastText: {
    fontSize: 14,
    color: Colors.dark.accentSecondary,
  },
  synopsisText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    lineHeight: 22,
  },
});
