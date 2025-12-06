import React, { useState } from "react";
import { FlatList, View, StyleSheet, RefreshControl, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { addDays, setHours, setMinutes, nextDay } from "date-fns";

import { AnimeCard } from "@/components/AnimeCard";
import { SkeletonCard } from "@/components/SkeletonCard";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { RootStackParamList } from "@/navigation/RootStackNavigator";

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
}

interface JikanResponse {
  data: AnimeItem[];
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

async function fetchAnimeSchedule(day: string): Promise<AnimeItem[]> {
  const response = await fetch(
    `https://api.jikan.moe/v4/schedules?filter=${day}&sfw=true&page=1`
  );

  if (!response.ok) {
    throw new Error("Failed to summon anime data");
  }

  const data: JikanResponse = await response.json();
  return data.data || [];
}

type NavigationProp = NativeStackNavigationProp<RootStackParamList, "Home">;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const navigation = useNavigation<NavigationProp>();
  
  const today = new Date().getDay();
  const todayIndex = (today + 6) % 7;
  const [selectedDay, setSelectedDay] = useState(todayIndex);

  const {
    data: animeList,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery<AnimeItem[]>({
    queryKey: ["/api/anime/schedule", DAYS[selectedDay]],
    queryFn: () => fetchAnimeSchedule(DAYS[selectedDay]),
    staleTime: 5 * 60 * 1000,
  });

  const handleAnimePress = (anime: AnimeItem) => {
    navigation.navigate("AnimeDetail", {
      animeId: anime.mal_id,
      title: anime.title,
      imageUrl: anime.images.jpg.large_image_url,
    });
  };

  const renderItem = ({ item }: { item: AnimeItem }) => (
    <AnimeCard
      malId={item.mal_id}
      title={item.title}
      imageUrl={item.images.jpg.large_image_url}
      nextAiringTime={getNextAiringDate(item.broadcast)}
      episodes={item.episodes}
      score={item.score}
      onPress={() => handleAnimePress(item)}
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
      <ThemedText style={styles.emptyText}>No anime airing on {DAY_LABELS[selectedDay]}</ThemedText>
    </View>
  );

  const renderDayTabs = () => (
    <View style={styles.tabsWrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsContainer}
      >
        {DAY_LABELS.map((label, index) => {
          const isSelected = selectedDay === index;
          const isToday = index === todayIndex;
          return (
            <Pressable
              key={label}
              onPress={() => setSelectedDay(index)}
              style={({ pressed }) => [
                styles.tabButton,
                isSelected && styles.tabButtonSelected,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <ThemedText
                style={[
                  styles.tabText,
                  isSelected && styles.tabTextSelected,
                ]}
              >
                {label}
              </ThemedText>
              {isToday ? <View style={styles.todayDot} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={{ paddingTop: headerHeight + Spacing.xl }}>
          {renderDayTabs()}
        </View>
        <FlatList
          style={styles.list}
          contentContainerStyle={{
            paddingTop: Spacing.lg,
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
        <View style={{ paddingTop: headerHeight + Spacing.xl }}>
          {renderDayTabs()}
        </View>
        <View style={styles.centeredContent}>
          {renderError()}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={{ paddingTop: headerHeight + Spacing.xl }}>
        {renderDayTabs()}
      </View>
      <FlatList
        style={styles.list}
        contentContainerStyle={{
          paddingTop: Spacing.lg,
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
  tabsWrapper: {
    marginBottom: Spacing.sm,
  },
  tabsContainer: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  tabButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.dark.backgroundDefault,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    alignItems: "center",
  },
  tabButtonSelected: {
    backgroundColor: Colors.dark.accent,
    borderColor: Colors.dark.accent,
  },
  tabText: {
    fontSize: 14,
    fontWeight: "500",
    color: Colors.dark.textSecondary,
  },
  tabTextSelected: {
    color: Colors.dark.text,
    fontWeight: "600",
  },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.dark.accentSecondary,
    marginTop: 4,
  },
});
