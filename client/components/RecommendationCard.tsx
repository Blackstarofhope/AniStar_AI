import React, { useState, useEffect } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  WithSpringConfig,
} from "react-native-reanimated";
import { differenceInSeconds } from "date-fns";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { apiRequest } from "@/lib/query-client";
import { useQueryClient } from "@tanstack/react-query";

interface RecommendationCardProps {
  malId: number;
  title: string;
  imageUrl: string;
  confidence: number;
  artworkVerified: boolean;
  artworkScore: number;
  genres: string[];
  score?: number;
  episodes?: number;
  broadcast?: { day?: string; time?: string };
  nextAiringTime?: Date | null;
  onPress?: () => void;
}

const springConfig: WithSpringConfig = {
  damping: 15,
  mass: 0.3,
  stiffness: 150,
  overshootClamping: true,
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function formatCountdown(targetDate: Date): string {
  const now = new Date();
  const diffSeconds = differenceInSeconds(targetDate, now);
  if (diffSeconds <= 0) return "Airing now!";
  const days = Math.floor(diffSeconds / 86400);
  const hours = Math.floor((diffSeconds % 86400) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function RecommendationCard({
  malId,
  title,
  imageUrl,
  confidence,
  artworkVerified,
  artworkScore,
  genres,
  score,
  episodes,
  broadcast,
  nextAiringTime,
  onPress,
}: RecommendationCardProps) {
  const scale = useSharedValue(1);
  const queryClient = useQueryClient();
  const [rated, setRated] = useState<"like" | "dislike" | null>(null);
  const [isRating, setIsRating] = useState(false);
  const [countdown, setCountdown] = useState(
    nextAiringTime ? formatCountdown(nextAiringTime) : null
  );

  useEffect(() => {
    if (!nextAiringTime) return;
    const interval = setInterval(() => {
      setCountdown(formatCountdown(nextAiringTime));
    }, 1000);
    return () => clearInterval(interval);
  }, [nextAiringTime]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => { scale.value = withSpring(0.97, springConfig); };
  const handlePressOut = () => { scale.value = withSpring(1, springConfig); };

  const handleRate = async (like: boolean) => {
    if (isRating) return;
    setIsRating(true);
    try {
      await apiRequest("POST", "/api/ai/feedback", {
        malId,
        rating: like ? 1 : 0,
      });
      setRated(like ? "like" : "dislike");
      queryClient.invalidateQueries({ queryKey: ["/api/ai/recommend"] });
    } catch {
      // silently fail
    } finally {
      setIsRating(false);
    }
  };

  const confidencePct = Math.round(confidence * 100);
  const confidenceColor =
    confidence > 0.75 ? Colors.dark.accent :
    confidence > 0.5 ? Colors.dark.accentSecondary :
    Colors.dark.neonPink;

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.container, animatedStyle]}
    >
      <View style={styles.imageContainer}>
        <Image
          source={{ uri: imageUrl }}
          style={styles.image}
          contentFit="cover"
          transition={300}
        />
        <LinearGradient
          colors={["transparent", "rgba(15, 15, 18, 0.85)", "rgba(15, 15, 18, 1)"]}
          style={styles.gradient}
        />

        <View style={styles.confidenceBadge}>
          <Ionicons name="sparkles" size={11} color={confidenceColor} />
          <ThemedText style={[styles.confidenceText, { color: confidenceColor }]}>
            {confidencePct}%
          </ThemedText>
        </View>

        <View style={styles.artworkBadge}>
          <Ionicons
            name={artworkVerified ? "checkmark-circle" : "alert-circle"}
            size={14}
            color={artworkVerified ? "#4ADE80" : "#FACC15"}
          />
        </View>

        {countdown ? (
          <View style={styles.countdownBadge}>
            <Ionicons name="time-outline" size={12} color={Colors.dark.accentSecondary} />
            <ThemedText style={styles.countdownText}>{countdown}</ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.content}>
        <ThemedText style={styles.title} numberOfLines={2}>{title}</ThemedText>

        {genres.length > 0 ? (
          <View style={styles.genreRow}>
            {genres.slice(0, 3).map((g) => (
              <View key={g} style={styles.genreTag}>
                <ThemedText style={styles.genreText}>{g}</ThemedText>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.footer}>
          <View style={styles.metaRow}>
            {episodes ? (
              <View style={styles.metaItem}>
                <Ionicons name="play-circle-outline" size={13} color={Colors.dark.textSecondary} />
                <ThemedText style={styles.metaText}>{episodes} eps</ThemedText>
              </View>
            ) : null}
            {score ? (
              <View style={styles.metaItem}>
                <Ionicons name="star" size={13} color={Colors.dark.accent} />
                <ThemedText style={styles.metaText}>{score.toFixed(1)}</ThemedText>
              </View>
            ) : null}
          </View>

          <View style={styles.ratingRow}>
            <Pressable
              onPress={() => handleRate(true)}
              disabled={isRating || rated !== null}
              style={({ pressed }) => [
                styles.rateButton,
                styles.likeButton,
                rated === "like" && styles.rateButtonActive,
                { opacity: pressed ? 0.7 : isRating ? 0.5 : 1 },
              ]}
              hitSlop={8}
            >
              <Ionicons
                name={rated === "like" ? "thumbs-up" : "thumbs-up-outline"}
                size={16}
                color={rated === "like" ? "#4ADE80" : Colors.dark.textSecondary}
              />
            </Pressable>
            <Pressable
              onPress={() => handleRate(false)}
              disabled={isRating || rated !== null}
              style={({ pressed }) => [
                styles.rateButton,
                styles.dislikeButton,
                rated === "dislike" && styles.rateButtonActiveNeg,
                { opacity: pressed ? 0.7 : isRating ? 0.5 : 1 },
              ]}
              hitSlop={8}
            >
              <Ionicons
                name={rated === "dislike" ? "thumbs-down" : "thumbs-down-outline"}
                size={16}
                color={rated === "dislike" ? Colors.dark.neonPink : Colors.dark.textSecondary}
              />
            </Pressable>
          </View>
        </View>
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    marginBottom: Spacing.lg,
  },
  imageContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
    position: "relative",
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
    height: "60%",
  },
  confidenceBadge: {
    position: "absolute",
    top: Spacing.md,
    right: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 15, 18, 0.88)",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    gap: 4,
  },
  confidenceText: {
    fontSize: 12,
    fontWeight: "700",
  },
  artworkBadge: {
    position: "absolute",
    top: Spacing.md,
    left: Spacing.md,
    width: 28,
    height: 28,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(15, 15, 18, 0.88)",
    justifyContent: "center",
    alignItems: "center",
  },
  countdownBadge: {
    position: "absolute",
    bottom: Spacing.md,
    right: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 15, 18, 0.85)",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
    gap: 3,
  },
  countdownText: {
    fontSize: 11,
    fontWeight: "600",
    color: Colors.dark.accentSecondary,
  },
  content: {
    padding: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.dark.text,
  },
  genreRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  genreTag: {
    backgroundColor: Colors.dark.backgroundSecondary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
  },
  genreText: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.xs,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.lg,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  metaText: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
  },
  ratingRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  rateButton: {
    width: 32,
    height: 32,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.dark.backgroundSecondary,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
  },
  likeButton: {},
  dislikeButton: {},
  rateButtonActive: {
    borderColor: "#4ADE80",
    backgroundColor: "rgba(74, 222, 128, 0.12)",
  },
  rateButtonActiveNeg: {
    borderColor: Colors.dark.neonPink,
    backgroundColor: "rgba(255, 0, 127, 0.12)",
  },
});
