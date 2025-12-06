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
import { useFavorites } from "@/hooks/useFavorites";

interface AnimeCardProps {
  malId: number;
  title: string;
  imageUrl: string;
  nextAiringTime: Date | null;
  episodes?: number;
  score?: number;
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

  if (diffSeconds <= 0) {
    return "Airing now!";
  }

  const days = Math.floor(diffSeconds / 86400);
  const hours = Math.floor((diffSeconds % 86400) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

export function AnimeCard({
  malId,
  title,
  imageUrl,
  nextAiringTime,
  episodes,
  score,
  onPress,
}: AnimeCardProps) {
  const scale = useSharedValue(1);
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorited = isFavorite(malId);
  const [countdown, setCountdown] = useState(
    nextAiringTime ? formatCountdown(nextAiringTime) : "TBA"
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

  const handlePressIn = () => {
    scale.value = withSpring(0.97, springConfig);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, springConfig);
  };

  const handleFavoritePress = () => {
    toggleFavorite({ mal_id: malId, title, imageUrl });
  };

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
          colors={["transparent", "rgba(15, 15, 18, 0.8)", "rgba(15, 15, 18, 1)"]}
          style={styles.gradient}
        />
        <View style={styles.countdownBadge}>
          <Ionicons name="time-outline" size={14} color={Colors.dark.accentSecondary} />
          <ThemedText style={styles.countdownText}>{countdown}</ThemedText>
        </View>
        <Pressable
          onPress={handleFavoritePress}
          style={({ pressed }) => [
            styles.favoriteButton,
            { opacity: pressed ? 0.7 : 1 },
          ]}
          hitSlop={8}
        >
          <Ionicons
            name={favorited ? "heart" : "heart-outline"}
            size={20}
            color={favorited ? Colors.dark.neonPink : Colors.dark.text}
          />
        </Pressable>
      </View>
      <View style={styles.content}>
        <ThemedText style={styles.title} numberOfLines={2}>
          {title}
        </ThemedText>
        <View style={styles.metaRow}>
          {episodes ? (
            <View style={styles.metaItem}>
              <Ionicons name="play-circle-outline" size={14} color={Colors.dark.textSecondary} />
              <ThemedText style={styles.metaText}>{episodes} eps</ThemedText>
            </View>
          ) : null}
          {score ? (
            <View style={styles.metaItem}>
              <Ionicons name="star" size={14} color={Colors.dark.accent} />
              <ThemedText style={styles.metaText}>{score.toFixed(1)}</ThemedText>
            </View>
          ) : null}
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
    height: "50%",
  },
  countdownBadge: {
    position: "absolute",
    top: Spacing.md,
    right: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 15, 18, 0.85)",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    gap: Spacing.xs,
  },
  countdownText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.dark.accentSecondary,
  },
  favoriteButton: {
    position: "absolute",
    top: Spacing.md,
    left: Spacing.md,
    width: 36,
    height: 36,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(15, 15, 18, 0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.dark.text,
    marginBottom: Spacing.sm,
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
    fontSize: 13,
    color: Colors.dark.textSecondary,
  },
});
