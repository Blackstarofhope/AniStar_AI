import React, { useRef, useCallback } from "react";
import { View, StyleSheet, PanResponder } from "react-native";
import { Colors, BorderRadius } from "@/constants/theme";

interface GemSliderProps {
  value: number;
  onValueChange?: (value: number) => void;
  onSlidingComplete?: (value: number) => void;
  style?: object;
}

export default function GemSlider({ value, onValueChange, onSlidingComplete, style }: GemSliderProps) {
  const trackWidth = useRef<number>(0);

  const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 20) / 20;

  const valueFromX = useCallback((x: number): number => {
    if (trackWidth.current === 0) return value;
    return clamp(x / trackWidth.current);
  }, [value]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const v = valueFromX(e.nativeEvent.locationX);
        onValueChange?.(v);
      },
      onPanResponderMove: (e) => {
        const v = valueFromX(e.nativeEvent.locationX);
        onValueChange?.(v);
      },
      onPanResponderRelease: (e) => {
        const v = valueFromX(e.nativeEvent.locationX);
        onValueChange?.(v);
        onSlidingComplete?.(v);
      },
    })
  ).current;

  const pct = `${Math.round(value * 100)}%`;

  return (
    <View
      style={[styles.track, style]}
      {...panResponder.panHandlers}
      onLayout={(e) => { trackWidth.current = e.nativeEvent.layout.width; }}
    >
      <View style={[styles.fill, { width: pct }]} />
      <View style={[styles.thumb, { left: pct }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flex: 1,
    height: 32,
    justifyContent: "center",
    position: "relative",
    paddingHorizontal: 8,
  },
  fill: {
    height: 3,
    backgroundColor: Colors.dark.accent,
    borderRadius: 2,
  },
  thumb: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.dark.accent,
    top: "50%",
    marginTop: -9,
    marginLeft: -9,
  },
});
