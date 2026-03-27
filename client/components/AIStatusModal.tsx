import React from "react";
import {
  View, Modal, StyleSheet, ScrollView, Pressable, Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface AIStatusModalProps {
  visible: boolean;
  onClose: () => void;
}

interface AIStatus {
  epoch: number;
  totalNeurons: number;
  kuramotoSyncIndex: number;
  ewcPenalty: number;
  replayBufferSize: number;
  replayBufferCapacity: number;
  goodnessHistory: number[];
  isTraining: boolean;
  neurogenesisGrowthEvents: number;
  neurogenesisPruneEvents: number;
  couplingStrength: number;
}

async function fetchAIStatus(): Promise<AIStatus> {
  const url = new URL("/api/ai/status", getApiUrl());
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Failed to fetch AI status");
  return res.json();
}

const CHART_WIDTH = Dimensions.get("window").width - Spacing.xl * 4 - 32;
const CHART_HEIGHT = 56;

function SparklineChart({ data }: { data: number[] }) {
  if (data.length < 2) {
    return (
      <View style={[sparkStyles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ThemedText style={sparkStyles.noData}>Training data will appear here</ThemedText>
      </View>
    );
  }

  const max = Math.max(...data) || 1;
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.slice(-20);
  const step = CHART_WIDTH / (pts.length - 1);

  const points = pts.map((v, i) => ({
    x: i * step,
    y: CHART_HEIGHT - ((v - min) / range) * (CHART_HEIGHT - 8),
  }));

  return (
    <View style={sparkStyles.container}>
      <View style={{ width: CHART_WIDTH, height: CHART_HEIGHT, position: "relative" }}>
        {points.slice(0, -1).map((pt, i) => {
          const next = points[i + 1];
          const dx = next.x - pt.x;
          const dy = next.y - pt.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);
          return (
            <View
              key={i}
              style={{
                position: "absolute",
                left: pt.x,
                top: pt.y,
                width: len,
                height: 2,
                backgroundColor: Colors.dark.accent,
                opacity: 0.5 + (i / points.length) * 0.5,
                transformOrigin: "0 50%",
                transform: [{ rotate: `${angle}deg` }],
              }}
            />
          );
        })}
        {points.map((pt, i) => (
          <View
            key={`dot-${i}`}
            style={{
              position: "absolute",
              left: pt.x - 3,
              top: pt.y - 3,
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === points.length - 1 ? Colors.dark.accentSecondary : Colors.dark.accent,
              opacity: 0.7,
            }}
          />
        ))}
      </View>
    </View>
  );
}

const sparkStyles = StyleSheet.create({
  container: {
    height: CHART_HEIGHT + 8,
    marginTop: Spacing.sm,
  },
  noData: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    fontStyle: "italic",
  },
});

function StatRow({ label, value, unit, color }: {
  label: string; value: string | number; unit?: string; color?: string;
}) {
  return (
    <View style={statStyles.row}>
      <ThemedText style={statStyles.label}>{label}</ThemedText>
      <View style={statStyles.valueRow}>
        <ThemedText style={[statStyles.value, color ? { color } : {}]}>
          {value}
        </ThemedText>
        {unit ? <ThemedText style={statStyles.unit}>{unit}</ThemedText> : null}
      </View>
    </View>
  );
}

const statStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.glassBorder,
  },
  label: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    flex: 1,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  value: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.dark.text,
  },
  unit: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
  },
});

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(1, value / max);
  return (
    <View style={progressStyles.track}>
      <View style={[progressStyles.fill, { width: `${pct * 100}%` as any, backgroundColor: color }]} />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: {
    height: 4,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: 2,
    overflow: "hidden",
    marginTop: 4,
  },
  fill: {
    height: "100%",
    borderRadius: 2,
  },
});

export function AIStatusModal({ visible, onClose }: AIStatusModalProps) {
  const insets = useSafeAreaInsets();

  const { data: status, isLoading, isError, refetch } = useQuery<AIStatus>({
    queryKey: ["/api/ai/status"],
    queryFn: fetchAIStatus,
    refetchInterval: visible ? 5000 : false,
    enabled: visible,
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <View style={styles.handle} />
          <View style={styles.titleRow}>
            <Ionicons name="hardware-chip-outline" size={20} color={Colors.dark.accent} />
            <ThemedText style={styles.title}>AI Neural Status</ThemedText>
            {status?.isTraining ? (
              <View style={styles.trainingBadge}>
                <ThemedText style={styles.trainingText}>TRAINING</ThemedText>
              </View>
            ) : null}
          </View>
          <Pressable onPress={onClose} style={styles.closeButton} hitSlop={12}>
            <Ionicons name="close" size={22} color={Colors.dark.text} />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <Ionicons name="sync-outline" size={32} color={Colors.dark.accent} />
              <ThemedText style={styles.loadingText}>Querying neural state...</ThemedText>
            </View>
          ) : isError ? (
            <View style={styles.loadingContainer}>
              <Ionicons name="alert-circle-outline" size={32} color={Colors.dark.neonPink} />
              <ThemedText style={styles.loadingText}>AI engine offline — start the server to activate</ThemedText>
              <Pressable onPress={() => refetch()} style={styles.retryButton}>
                <ThemedText style={styles.retryText}>Retry</ThemedText>
              </Pressable>
            </View>
          ) : status ? (
            <>
              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>LEARNING</ThemedText>
                <StatRow label="Training Epoch" value={status.epoch} />
                <StatRow
                  label="Total Neurons"
                  value={status.totalNeurons}
                  color={Colors.dark.accentSecondary}
                />
                <StatRow label="Growth Events" value={status.neurogenesisGrowthEvents} unit="grown" />
                <StatRow label="Prune Events" value={status.neurogenesisPruneEvents} unit="pruned" />
              </View>

              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>KURAMOTO COUPLING</ThemedText>
                <StatRow
                  label="Synchrony Index"
                  value={`${Math.round(status.kuramotoSyncIndex * 100)}%`}
                  color={
                    status.kuramotoSyncIndex > 0.7 ? "#4ADE80" :
                    status.kuramotoSyncIndex > 0.4 ? Colors.dark.accentSecondary :
                    Colors.dark.neonPink
                  }
                />
                <ProgressBar
                  value={status.kuramotoSyncIndex}
                  max={1}
                  color={
                    status.kuramotoSyncIndex > 0.7 ? "#4ADE80" :
                    status.kuramotoSyncIndex > 0.4 ? Colors.dark.accentSecondary :
                    Colors.dark.neonPink
                  }
                />
                <StatRow label="Coupling Strength (K)" value={status.couplingStrength} />
              </View>

              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>CONTINUAL LEARNING</ThemedText>
                <StatRow
                  label="EWC Penalty"
                  value={status.ewcPenalty.toFixed(4)}
                  color={status.ewcPenalty > 0.1 ? Colors.dark.accentSecondary : Colors.dark.text}
                />
                <StatRow
                  label="Replay Buffer"
                  value={`${status.replayBufferSize} / ${status.replayBufferCapacity}`}
                />
                <ProgressBar
                  value={status.replayBufferSize}
                  max={status.replayBufferCapacity}
                  color={Colors.dark.accent}
                />
              </View>

              <View style={styles.section}>
                <ThemedText style={styles.sectionTitle}>GOODNESS HISTORY</ThemedText>
                <SparklineChart data={status.goodnessHistory} />
                <View style={styles.chartLabels}>
                  <ThemedText style={styles.chartLabel}>Earlier</ThemedText>
                  <ThemedText style={styles.chartLabel}>Latest</ThemedText>
                </View>
              </View>

              <View style={styles.legend}>
                <Ionicons name="information-circle-outline" size={14} color={Colors.dark.textSecondary} />
                <ThemedText style={styles.legendText}>
                  Rate anime with thumbs up/down to train the Forward-Forward neural network.
                  The Kuramoto coupling synchronizes text and vision understanding over time.
                </ThemedText>
              </View>
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
  },
  header: {
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.glassBorder,
    alignItems: "center",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.dark.glassBorder,
    marginBottom: Spacing.lg,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: Colors.dark.text,
  },
  trainingBadge: {
    backgroundColor: Colors.dark.accent,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  trainingText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.5,
  },
  closeButton: {
    position: "absolute",
    right: Spacing.xl,
    top: Spacing.lg + 20,
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: Spacing.xl,
    paddingTop: Spacing.lg,
    gap: Spacing.xl,
    paddingBottom: Spacing["3xl"],
  },
  section: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    gap: 0,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: Colors.dark.accent,
    marginBottom: Spacing.sm,
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: Spacing["4xl"],
    gap: Spacing.lg,
  },
  loadingText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
    textAlign: "center",
  },
  retryButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.dark.accent,
    borderRadius: BorderRadius.full,
  },
  retryText: {
    color: "#fff",
    fontWeight: "600",
  },
  chartLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: Spacing.xs,
  },
  chartLabel: {
    fontSize: 10,
    color: Colors.dark.textSecondary,
  },
  legend: {
    flexDirection: "row",
    gap: Spacing.sm,
    padding: Spacing.md,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
  },
  legendText: {
    flex: 1,
    fontSize: 12,
    color: Colors.dark.textSecondary,
    lineHeight: 18,
  },
});
