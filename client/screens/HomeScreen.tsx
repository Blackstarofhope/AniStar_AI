import React from "react";
import { FlatList, View, StyleSheet, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { addDays, setHours, setMinutes, nextDay, parseISO } from "date-fns";

import { AnimeCard } from "@/components/AnimeCard";
import { SkeletonCard } from "@/components/SkeletonCard";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing } from "@/constants/theme";

interface AnimeItem {
  mal_id: number;
  title: string;
  images: {
    jpg: {
      large_image_url: string;
    };
  };
  broadcast?: {
    day?: string;
    time?: string;
  };
  episodes?: number;
  score?: number;
  aired?: {
    from?: string;
  };
}

interface JikanResponse {
  data: AnimeItem[];
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
  if (!broadcast?.day || !broadcast?.time) {
    return null;
  }

  const dayOfWeek = DAY_MAP[broadcast.day];
  if (dayOfWeek === undefined) {
    return null;
  }

  const [hours, minutes] = broadcast.time.split(":").map(Number);
  if (isNaN(hours) || isNaN(minutes)) {
    return null;
  }

  const now = new Date();
  const jstOffset = 9 * 60;
  const localOffset = -now.getTimezoneOffset();
  const offsetDiff = (jstOffset - localOffset) * 60 * 1000;

  let nextBroadcast = nextDay(now, dayOfWeek);
  nextBroadcast = setHours(nextBroadcast, hours);
  nextBroadcast = setMinutes(nextBroadcast, minutes);

  const localBroadcast = new Date(nextBroadcast.getTime() - offsetDiff);

  if (localBroadcast < now) {
    const weekLater = addDays(localBroadcast, 7);
    return weekLater;
  }

  return localBroadcast;
}

async function fetchAnimeSchedule(): Promise<AnimeItem[]> {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const today = new Date().getDay();
  const todayName = days[(today + 6) % 7];

  const response = await fetch(
    `https://api.jikan.moe/v4/schedules?filter=${todayName}&sfw=true&page=1`
  );

  if (!response.ok) {
    throw new Error("Failed to summon anime data");
  }

  const data: JikanResponse = await response.json();
  return data.data || [];
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const {
    data: animeList,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery<AnimeItem[]>({
    queryKey: ["/api/anime/schedule"],
    queryFn: fetchAnimeSchedule,
    staleTime: 5 * 60 * 1000,
  });

  const renderItem = ({ item }: { item: AnimeItem }) => (
    <AnimeCard
      title={item.title}
      imageUrl={item.images.jpg.large_image_url}
      nextAiringTime={getNextAiringDate(item.broadcast)}
      episodes={item.episodes}
      score={item.score}
    />
  );

  const renderSkeleton = () => (
    <View>
      {Array.from({ length: 5 }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </View>
  );

  const renderError = () => (
    <View style={styles.errorContainer}>
      <Ionicons name="alert-circle-outline" size={64} color={Colors.dark.accent} />
      <ThemedText style={styles.errorTitle}>Connection Severed</ThemedText>
      <ThemedText style={styles.errorText}>
        Failed to summon anime data from the void. Please try again.
      </ThemedText>
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="film-outline" size={64} color={Colors.dark.textSecondary} />
      <ThemedText style={styles.emptyText}>No anime airing today</ThemedText>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <FlatList
          style={styles.list}
          contentContainerStyle={{
            paddingTop: headerHeight + Spacing.xl,
            paddingBottom: insets.bottom + Spacing.xl,
            paddingHorizontal: Spacing.lg,
          }}
          data={[1]}
          renderItem={renderSkeleton}
          keyExtractor={() => "skeleton"}
          scrollIndicatorInsets={{ bottom: insets.bottom }}
        />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.container}>
        <View
          style={[
            styles.centeredContent,
            { paddingTop: headerHeight + Spacing.xl },
          ]}
        >
          {renderError()}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        style={styles.list}
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.xl,
          paddingBottom: insets.bottom + Spacing.xl,
          paddingHorizontal: Spacing.lg,
          flexGrow: 1,
        }}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        data={animeList}
        renderItem={renderItem}
        keyExtractor={(item) => item.mal_id.toString()}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={Colors.dark.accent}
            colors={[Colors.dark.accent]}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  list: {
    flex: 1,
  },
  centeredContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
  },
  errorContainer: {
    alignItems: "center",
    paddingHorizontal: Spacing.xl,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: Colors.dark.text,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  errorText: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: "center",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: Spacing["5xl"],
  },
  emptyText: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
    marginTop: Spacing.lg,
  },
});
