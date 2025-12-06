import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

import { Colors, Spacing, BorderRadius } from "@/constants/theme";

export function SkeletonCard() {
  const shimmerPosition = useSharedValue(-1);

  useEffect(() => {
    shimmerPosition.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.linear }),
      -1,
      false
    );
  }, []);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerPosition.value * 300 }],
  }));

  return (
    <View style={styles.container}>
      <View style={styles.imageContainer}>
        <View style={styles.shimmerBase}>
          <Animated.View style={[styles.shimmerOverlay, shimmerStyle]}>
            <LinearGradient
              colors={[
                "transparent",
                "rgba(255, 255, 255, 0.05)",
                "transparent",
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.gradient}
            />
          </Animated.View>
        </View>
      </View>
      <View style={styles.content}>
        <View style={[styles.titleSkeleton, styles.shimmerBase]}>
          <Animated.View style={[styles.shimmerOverlay, shimmerStyle]}>
            <LinearGradient
              colors={[
                "transparent",
                "rgba(255, 255, 255, 0.05)",
                "transparent",
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.gradient}
            />
          </Animated.View>
        </View>
        <View style={styles.metaRow}>
          <View style={[styles.metaSkeleton, styles.shimmerBase]}>
            <Animated.View style={[styles.shimmerOverlay, shimmerStyle]}>
              <LinearGradient
                colors={[
                  "transparent",
                  "rgba(255, 255, 255, 0.05)",
                  "transparent",
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradient}
              />
            </Animated.View>
          </View>
          <View style={[styles.metaSkeleton, styles.shimmerBase]}>
            <Animated.View style={[styles.shimmerOverlay, shimmerStyle]}>
              <LinearGradient
                colors={[
                  "transparent",
                  "rgba(255, 255, 255, 0.05)",
                  "transparent",
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.gradient}
              />
            </Animated.View>
          </View>
        </View>
      </View>
    </View>
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
  },
  shimmerBase: {
    backgroundColor: Colors.dark.shimmer,
    overflow: "hidden",
    height: "100%",
  },
  shimmerOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 150,
  },
  gradient: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  titleSkeleton: {
    height: 20,
    borderRadius: BorderRadius.xs,
    marginBottom: Spacing.sm,
    width: "80%",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.lg,
  },
  metaSkeleton: {
    height: 14,
    borderRadius: BorderRadius.xs,
    width: 60,
  },
});
