import React, { useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { addDays, setHours, setMinutes, nextDay } from "date-fns";

import { ThemedText } from "@/components/ThemedText";
import { RecommendationCard } from "@/components/RecommendationCard";
import { AIStatusModal } from "@/components/AIStatusModal";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";
import type { RecsStackParamList } from "@/navigation/types";

type NavProp = NativeStackNavigationProp<RecsStackParamList, "Recommendations">;

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
  const local = new Date(nextBroadcast.getTime() - offsetDiff);

  return local < now ? addDays(local, 7) : local;
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
  episodes?: number;
  broadcast?: { day?: string; time?: string };
}

async function fetchRecommendations(): Promise<Recommendation[]> {
  const url = new URL("/api/ai/recommend?limit=15", getApiUrl());
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to fetch recommendations");
  const json = await res.json() as { recommendations: Recommendation[] };
  return json.recommendations || [];
}

export default function RecommendationsScreen() {
  const navigation = useNavigation<NavProp>();
  const headerHeight = useHeaderHeight();
  const [statusVisible, setStatusVisible] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<Recommendation[]>({
    queryKey: ["/api/ai/recommend"],
    queryFn: fetchRecommendations,
    staleTime: 2 * 60 * 1000,
    retry: 2,
  });

  React.useLayoutEffect(() => {
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

  const renderItem = useCallback(
    ({ item }: { item: Recommendation }) => {
      const airingDate = getNextAiringDate(item.broadcast);
      return (
        <RecommendationCard
          malId={item.mal_id}
          title={item.title}
          imageUrl={item.imageUrl}
          confidence={item.confidence}
          artworkVerified={item.artworkVerified}
          artworkScore={item.artworkScore}
          genres={item.genres}
          score={item.score}
          episodes={item.episodes}
          broadcast={item.broadcast}
          nextAiringTime={airingDate}
          onPress={() => handleCardPress(item)}
        />
      );
    },
    [handleCardPress]
  );

  const keyExtractor = useCallback((item: Recommendation) => String(item.mal_id), []);

  return (
    <View style={styles.container}>
      {isLoading ? (
        <View style={[styles.centered, { paddingTop: headerHeight }]}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={Colors.dark.accent} />
            <ThemedText style={styles.loadingTitle}>Neural Network Loading</ThemedText>
            <ThemedText style={styles.loadingSubtitle}>
              Synchronizing Kuramoto oscillators...
            </ThemedText>
          </View>
        </View>
      ) : isError ? (
        <View style={[styles.centered, { paddingTop: headerHeight }]}>
          <View style={styles.errorCard}>
            <Ionicons name="warning-outline" size={40} color={Colors.dark.neonPink} />
            <ThemedText style={styles.errorTitle}>Engine Offline</ThemedText>
            <ThemedText style={styles.errorSubtitle}>
              The AI server is not reachable. Make sure the dev server is running.
            </ThemedText>
            <Pressable onPress={() => refetch()} style={styles.retryButton}>
              <Ionicons name="refresh-outline" size={16} color="#fff" />
              <ThemedText style={styles.retryText}>Retry</ThemedText>
            </Pressable>
          </View>
        </View>
      ) : (
        <FlatList
          data={data || []}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            { paddingTop: headerHeight + Spacing.lg },
          ]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<ListHeader />}
          ListEmptyComponent={<EmptyState onRefetch={refetch} />}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={Colors.dark.accent}
            />
          }
        />
      )}

      <AIStatusModal visible={statusVisible} onClose={() => setStatusVisible(false)} />
    </View>
  );
}

function ListHeader() {
  return (
    <View style={headerStyles.container}>
      <Ionicons name="sparkles-outline" size={14} color={Colors.dark.accent} />
      <ThemedText style={headerStyles.subtitle}>
        Powered by Forward-Forward learning and Kuramoto coupling
      </ThemedText>
    </View>
  );
}

function EmptyState({ onRefetch }: { onRefetch: () => void }) {
  return (
    <View style={emptyStyles.container}>
      <Ionicons name="sparkles-outline" size={56} color={Colors.dark.accent} style={{ opacity: 0.5 }} />
      <ThemedText style={emptyStyles.title}>Discovering Anime</ThemedText>
      <ThemedText style={emptyStyles.subtitle}>
        Rate some anime in the Schedule tab with thumbs up/down to teach the AI your taste.
      </ThemedText>
      <Pressable onPress={onRefetch} style={emptyStyles.button}>
        <Ionicons name="refresh-outline" size={16} color={Colors.dark.accent} />
        <ThemedText style={emptyStyles.buttonText}>Refresh</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  loadingCard: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.xl,
    padding: Spacing["3xl"],
    alignItems: "center",
    gap: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    width: "100%",
    maxWidth: 320,
  },
  loadingTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.text,
  },
  loadingSubtitle: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    textAlign: "center",
  },
  errorCard: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.xl,
    padding: Spacing["3xl"],
    alignItems: "center",
    gap: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    width: "100%",
    maxWidth: 320,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.dark.neonPink,
  },
  errorSubtitle: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.dark.accent,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
  },
  retryText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing["4xl"],
  },
});

const headerStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    lineHeight: 17,
    flex: 1,
  },
});

const emptyStyles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingTop: Spacing["4xl"],
    gap: Spacing.lg,
    paddingHorizontal: Spacing.xl,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.dark.text,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.dark.accent,
    marginTop: Spacing.md,
  },
  buttonText: {
    color: Colors.dark.accent,
    fontWeight: "600",
  },
});
