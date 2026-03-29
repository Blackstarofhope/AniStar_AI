import React, { useState, useLayoutEffect } from "react";
import {
  FlatList, View, StyleSheet, RefreshControl, ScrollView, Pressable,
  Modal, TextInput, ActivityIndicator, Platform, KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { addDays, setHours, setMinutes, nextDay } from "date-fns";
import { HeaderButton } from "@react-navigation/elements";

import { AnimeCard } from "@/components/AnimeCard";
import { SkeletonCard } from "@/components/SkeletonCard";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { RootStackParamList } from "@/navigation/RootStackNavigator";
import { useUser } from "@/contexts/UserContext";

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
  const { getApiUrl } = await import("@/lib/query-client");
  const url = new URL(`/api/anime/schedule?day=${encodeURIComponent(day)}`, getApiUrl());
  const response = await fetch(url.toString());

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
  const { displayName, saveDisplayName } = useUser();

  const today = new Date().getDay();
  const todayIndex = (today + 6) % 7;
  const [selectedDay, setSelectedDay] = useState(todayIndex);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderButton
          onPress={() => {
            setNewName(displayName ?? "");
            setSaveError(null);
            setSettingsVisible(true);
          }}
          accessibilityLabel="Profile settings"
        >
          <Ionicons name="person-circle-outline" size={24} color={Colors.dark.accent} />
        </HeaderButton>
      ),
    });
  }, [navigation, displayName]);

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

  const handleSaveName = async () => {
    const trimmed = newName.trim();
    if (trimmed.length < 2) {
      setSaveError("Name must be at least 2 characters.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveDisplayName(trimmed);
      setSettingsVisible(false);
    } catch {
      setSaveError("Could not save. Please try again.");
    } finally {
      setIsSaving(false);
    }
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

  const renderSettingsModal = () => (
    <Modal
      visible={settingsVisible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setSettingsVisible(false)}
    >
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.modalContainer, { paddingBottom: insets.bottom + Spacing.xl }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle}>Profile</ThemedText>
            <Pressable
              onPress={() => setSettingsVisible(false)}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              hitSlop={12}
            >
              <Ionicons name="close" size={22} color={Colors.dark.textSecondary} />
            </Pressable>
          </View>

          {displayName ? (
            <ThemedText style={styles.currentName}>
              Current name: <ThemedText style={styles.currentNameValue}>{displayName}</ThemedText>
            </ThemedText>
          ) : null}

          <ThemedText style={styles.inputLabel}>New display name</ThemedText>
          <TextInput
            style={[styles.modalInput, saveError ? styles.modalInputError : null]}
            value={newName}
            onChangeText={(t) => { setNewName(t); setSaveError(null); }}
            placeholder="Enter display name"
            placeholderTextColor={Colors.dark.tabIconDefault}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={32}
            returnKeyType="done"
            onSubmitEditing={handleSaveName}
            autoFocus
          />
          {saveError ? (
            <ThemedText style={styles.errorLabel}>{saveError}</ThemedText>
          ) : (
            <ThemedText style={styles.hintLabel}>2–32 characters</ThemedText>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.saveButton,
              (newName.trim().length < 2 || isSaving) && styles.saveButtonDisabled,
              pressed && newName.trim().length >= 2 && !isSaving && styles.saveButtonPressed,
            ]}
            onPress={handleSaveName}
            disabled={newName.trim().length < 2 || isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <ThemedText style={styles.saveButtonText}>Save</ThemedText>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
        {renderSettingsModal()}
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
        {renderSettingsModal()}
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
      {renderSettingsModal()}
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
  modalRoot: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundDefault,
  },
  modalContainer: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.dark.glassBorder,
    alignSelf: "center",
    marginBottom: Spacing.xl,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.xl,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.dark.text,
  },
  currentName: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    marginBottom: Spacing.xl,
  },
  currentNameValue: {
    fontSize: 14,
    color: Colors.dark.accent,
    fontWeight: "600",
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.dark.textSecondary,
    marginBottom: Spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  modalInput: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: 17,
    color: Colors.dark.text,
    marginBottom: Spacing.sm,
  },
  modalInputError: {
    borderColor: Colors.dark.neonPink,
  },
  hintLabel: {
    fontSize: 12,
    color: Colors.dark.tabIconDefault,
    marginBottom: Spacing.xl,
  },
  errorLabel: {
    fontSize: 13,
    color: Colors.dark.neonPink,
    marginBottom: Spacing.xl,
  },
  saveButton: {
    backgroundColor: Colors.dark.accent,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md + 2,
    alignItems: "center",
    shadowColor: Colors.dark.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonPressed: {
    opacity: 0.85,
  },
  saveButtonText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
  },
});
