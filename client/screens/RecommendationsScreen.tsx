import React, { useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useQuery } from "@tanstack/react-query";
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
  episodes?: number;
  broadcast?: { day?: string; time?: string };
}

async function fetchRecommendations(userId: string): Promise<Recommendation[]> {
  const url = new URL("/api/ai/recommend", getApiUrl());
  url.searchParams.set("limit", "5");
  url.searchParams.set("userId", userId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to fetch recommendations");
  const json = (await res.json()) as { recommendations: Recommendation[] };
  return json.recommendations || [];
}

function CompactRecCard({
  item,
  onPress,
}: {
  item: Recommendation;
  onPress: () => void;
}) {
  const confidenceColor =
    item.confidence > 0.75
      ? Colors.dark.accent
      : item.confidence > 0.5
      ? Colors.dark.accentSecondary
      : Colors.dark.neonPink;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [compactStyles.card, pressed && { opacity: 0.85 }]}
    >
      <Image
        source={{ uri: item.imageUrl }}
        style={compactStyles.image}
        contentFit="cover"
        transition={300}
      />
      <LinearGradient
        colors={["transparent", "rgba(15, 15, 18, 0.97)"]}
        style={compactStyles.gradient}
      />
      <View style={compactStyles.confidenceBadge}>
        <Ionicons name="sparkles" size={9} color={confidenceColor} />
        <ThemedText style={[compactStyles.confidenceText, { color: confidenceColor }]}>
          {Math.round(item.confidence * 100)}%
        </ThemedText>
      </View>
      {item.artworkVerified ? (
        <View style={compactStyles.verifiedBadge}>
          <Ionicons name="checkmark-circle" size={12} color="#4ADE80" />
        </View>
      ) : null}
      <View style={compactStyles.titleArea}>
        <ThemedText style={compactStyles.title} numberOfLines={2}>
          {item.title}
        </ThemedText>
        {item.score ? (
          <View style={compactStyles.scoreRow}>
            <Ionicons name="star" size={10} color={Colors.dark.accent} />
            <ThemedText style={compactStyles.scoreText}>{item.score.toFixed(1)}</ThemedText>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function RecStrip({
  data,
  isLoading,
  isError,
  isFetching,
  onRefetch,
  onCardPress,
}: {
  data: Recommendation[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  onRefetch: () => void;
  onCardPress: (item: Recommendation) => void;
}) {
  return (
    <ScrollView
      style={stripStyles.outerScroll}
      contentContainerStyle={stripStyles.container}
      showsVerticalScrollIndicator={false}
      bounces
      refreshControl={
        <RefreshControl
          refreshing={isFetching}
          onRefresh={onRefetch}
          tintColor={Colors.dark.accent}
          colors={[Colors.dark.accent]}
        />
      }
    >
      <View style={stripStyles.labelRow}>
        <Ionicons name="sparkles-outline" size={13} color={Colors.dark.accent} />
        <ThemedText style={stripStyles.label}>Star&apos;s Top Picks</ThemedText>
        <Pressable
          onPress={onRefetch}
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Ionicons
            name="refresh-outline"
            size={14}
            color={isFetching ? Colors.dark.accent : Colors.dark.textSecondary}
          />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={stripStyles.loadingRow}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[compactStyles.card, compactStyles.skeleton]} />
          ))}
        </View>
      ) : isError ? (
        <View style={stripStyles.errorRow}>
          <Ionicons name="warning-outline" size={16} color={Colors.dark.neonPink} />
          <ThemedText style={stripStyles.errorText}>Picks unavailable</ThemedText>
          <Pressable onPress={onRefetch} style={stripStyles.retryBtn}>
            <ThemedText style={stripStyles.retryText}>Retry</ThemedText>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={stripStyles.scrollContent}
        >
          {(data || []).length === 0 ? (
            <View style={stripStyles.emptyCard}>
              <Ionicons
                name="sparkles-outline"
                size={24}
                color={Colors.dark.accent}
                style={{ opacity: 0.5 }}
              />
              <ThemedText style={stripStyles.emptyText}>
                Chat with Star to get picks
              </ThemedText>
            </View>
          ) : (
            (data || []).slice(0, 5).map((item) => (
              <CompactRecCard
                key={item.mal_id}
                item={item}
                onPress={() => onCardPress(item)}
              />
            ))
          )}
        </ScrollView>
      )}
    </ScrollView>
  );
}

export default function RecommendationsScreen() {
  const navigation = useNavigation<NavProp>();
  const headerHeight = useHeaderHeight();
  const [statusVisible, setStatusVisible] = useState(false);
  const { userId } = useUser();

  const { data, isLoading, isError, refetch, isFetching } = useQuery<Recommendation[]>({
    queryKey: ["/api/ai/recommend", userId],
    queryFn: () => fetchRecommendations(userId),
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

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: headerHeight }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
      <RecStrip
        data={data}
        isLoading={isLoading}
        isError={isError}
        isFetching={isFetching}
        onRefetch={refetch}
        onCardPress={handleCardPress}
      />

      <StarChat />

      <AIStatusModal visible={statusVisible} onClose={() => setStatusVisible(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
});

const stripStyles = StyleSheet.create({
  outerScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  container: {
    backgroundColor: Colors.dark.backgroundRoot,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.glassBorder,
    paddingBottom: Spacing.sm,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: Colors.dark.accent,
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  loadingRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
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
  emptyCard: {
    width: 200,
    height: 180,
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },
});

const compactStyles = StyleSheet.create({
  card: {
    width: 120,
    height: 180,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    backgroundColor: Colors.dark.backgroundDefault,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    position: "relative",
  },
  skeleton: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderColor: Colors.dark.glassBorder,
    opacity: 0.7,
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
    height: "65%",
  },
  confidenceBadge: {
    position: "absolute",
    top: Spacing.xs,
    right: Spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 15, 18, 0.88)",
    paddingHorizontal: Spacing.xs,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    gap: 3,
  },
  confidenceText: {
    fontSize: 10,
    fontWeight: "700",
  },
  verifiedBadge: {
    position: "absolute",
    top: Spacing.xs,
    left: Spacing.xs,
    width: 20,
    height: 20,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(15, 15, 18, 0.88)",
    justifyContent: "center",
    alignItems: "center",
  },
  titleArea: {
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
    lineHeight: 14,
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
});
