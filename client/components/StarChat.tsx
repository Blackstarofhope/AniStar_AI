import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  cancelAnimation,
} from "react-native-reanimated";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useFocusEffect } from "@react-navigation/native";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { getApiUrl } from "@/lib/query-client";
import { useUser } from "@/contexts/UserContext";

interface Message {
  id: string;
  role: "star" | "user";
  content: string;
}

interface ChatHistoryItem {
  role: "user" | "star";
  content: string;
}

interface StarChatProps {
  initialMessage?: string;
}

async function postChat(
  message: string,
  history: ChatHistoryItem[],
  userId: string
): Promise<{ response: string; implicitFeedback: boolean }> {
  const url = new URL("/api/ai/chat", getApiUrl());
  url.searchParams.set("userId", userId);
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) throw new Error("Chat unavailable");
  return res.json();
}

async function fetchChatUsage(
  userId: string
): Promise<{ count: number; cap: number; remaining: number }> {
  const url = new URL("/api/user/chat-usage", getApiUrl());
  url.searchParams.set("userId", userId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("Usage unavailable");
  return res.json();
}

function TypingDot({ delay }: { delay: number }) {
  const opacity = useSharedValue(0.25);

  useEffect(() => {
    opacity.value = withRepeat(
      withDelay(delay, withTiming(1, { duration: 400 })),
      -1,
      true
    );
    return () => {
      cancelAnimation(opacity);
      opacity.value = 0.25;
    };
  }, [delay, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[dotStyles.dot, style]} />;
}

function TypingIndicator() {
  return (
    <View style={bubbleStyles.starRow}>
      <View style={bubbleStyles.avatar}>
        <Ionicons name="star" size={12} color={Colors.dark.accent} />
      </View>
      <View style={bubbleStyles.typingBubble}>
        <TypingDot delay={0} />
        <TypingDot delay={200} />
        <TypingDot delay={400} />
      </View>
    </View>
  );
}

function StarBubble({ content }: { content: string }) {
  return (
    <View style={bubbleStyles.starRow}>
      <View style={bubbleStyles.avatar}>
        <Ionicons name="star" size={12} color={Colors.dark.accent} />
      </View>
      <View style={bubbleStyles.starBubble}>
        <ThemedText style={bubbleStyles.starText}>{content}</ThemedText>
      </View>
    </View>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <View style={bubbleStyles.userRow}>
      <View style={bubbleStyles.userBubble}>
        <ThemedText style={bubbleStyles.userText}>{content}</ThemedText>
      </View>
    </View>
  );
}

const STAR_WELCOME =
  "I'm Star — I exist to connect you with the stories that were made for you. What are you in the mood for?";

interface ChatUsage {
  count: number;
  cap: number;
  remaining: number;
}

export function StarChat({ initialMessage }: StarChatProps) {
  const tabBarHeight = useBottomTabBarHeight();
  const { userId } = useUser();

  const [messages, setMessages] = useState<Message[]>([
    { id: "welcome", role: "star", content: initialMessage ?? STAR_WELCOME },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chatUsage, setChatUsage] = useState<ChatUsage | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const refreshUsage = useCallback(() => {
    fetchChatUsage(userId)
      .then(setChatUsage)
      .catch(() => {});
  }, [userId]);

  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);

  // Refresh chat usage on every focus + poll every 60s while focused.
  // Prevents the stale-state deadlock where an at-cap reading from a previous
  // day blocks the user from sending — and therefore from ever refreshing.
  useFocusEffect(
    useCallback(() => {
      refreshUsage();
      const intervalId = setInterval(() => {
        refreshUsage();
      }, 60_000);
      return () => clearInterval(intervalId);
    }, [refreshUsage])
  );

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 50);
  }, []);

  const isAtCap = chatUsage !== null && chatUsage.remaining <= 0;

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading || isAtCap) return;
    setInput("");

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    scrollToBottom();

    const historyForApi: ChatHistoryItem[] = messages
      .slice(-14)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const data = await postChat(text, historyForApi, userId);
      setMessages((prev) => [
        ...prev,
        { id: `s-${Date.now()}`, role: "star", content: data.response },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "star",
          content: "Something interrupted me. Try again?",
        },
      ]);
    } finally {
      setIsLoading(false);
      scrollToBottom();
      refreshUsage();
    }
  }, [input, isLoading, isAtCap, messages, scrollToBottom, userId, refreshUsage]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.starIconWrap}>
          <Ionicons name="star" size={14} color={Colors.dark.accent} />
        </View>
        <ThemedText style={styles.headerName}>Star</ThemedText>
        <ThemedText style={styles.headerSub}>Your AI anime guide</ThemedText>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messagesScroll}
        contentContainerStyle={[
          styles.messagesContent,
          { paddingBottom: tabBarHeight + Spacing.lg },
        ]}
        onContentSizeChange={scrollToBottom}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {messages.map((msg) =>
          msg.role === "star" ? (
            <StarBubble key={msg.id} content={msg.content} />
          ) : (
            <UserBubble key={msg.id} content={msg.content} />
          )
        )}
        {isLoading ? <TypingIndicator /> : null}
      </ScrollView>

      <View style={styles.inputArea}>
        {chatUsage !== null ? (
          <View style={styles.usageBar}>
            {isAtCap ? (
              <ThemedText style={styles.usageCapped}>
                Daily limit reached — Star returns tomorrow
              </ThemedText>
            ) : (
              <ThemedText style={styles.usageCount}>
                {chatUsage.count}/{chatUsage.cap} messages today
              </ThemedText>
            )}
          </View>
        ) : null}

        <View
          style={[
            styles.inputRow,
            Platform.OS === "ios" ? styles.inputRowIos : styles.inputRowAndroid,
            { paddingBottom: tabBarHeight + (Platform.OS === "ios" ? Spacing.md : Spacing.lg) },
          ]}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={
              isAtCap
                ? "Daily limit reached — come back tomorrow"
                : "Tell Star what you're looking for..."
            }
            placeholderTextColor={Colors.dark.textSecondary}
            style={[styles.input, isAtCap && styles.inputDisabled]}
            returnKeyType="send"
            onSubmitEditing={sendMessage}
            editable={!isLoading && !isAtCap}
            multiline={false}
          />
          <Pressable
            onPress={sendMessage}
            disabled={!input.trim() || isLoading || isAtCap}
            style={({ pressed }) => [
              styles.sendButton,
              (!input.trim() || isLoading || isAtCap) && styles.sendButtonDisabled,
              pressed && { opacity: 0.75 },
            ]}
            hitSlop={8}
          >
            <Ionicons name="arrow-up" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const dotStyles = StyleSheet.create({
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.dark.accent,
    marginHorizontal: 2,
  },
});

const bubbleStyles = StyleSheet.create({
  starRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: Spacing.md,
    paddingRight: "20%",
  },
  userRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: Spacing.md,
    paddingLeft: "20%",
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.dark.accent,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Spacing.sm,
    flexShrink: 0,
    shadowColor: Colors.dark.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
  },
  starBubble: {
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexShrink: 1,
    borderLeftWidth: 2,
    borderLeftColor: Colors.dark.accent,
  },
  starText: {
    fontSize: 14,
    color: Colors.dark.text,
    lineHeight: 21,
  },
  userBubble: {
    backgroundColor: Colors.dark.accent,
    borderRadius: BorderRadius.sm,
    borderTopRightRadius: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexShrink: 1,
  },
  userText: {
    fontSize: 14,
    color: "#fff",
    lineHeight: 21,
  },
  typingBubble: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.dark.backgroundDefault,
    borderRadius: BorderRadius.sm,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    borderLeftWidth: 2,
    borderLeftColor: Colors.dark.accent,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    height: 40,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
    borderTopWidth: 1,
    borderTopColor: Colors.dark.glassBorder,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.glassBorder,
    backgroundColor: Colors.dark.backgroundDefault,
    gap: Spacing.sm,
  },
  starIconWrap: {
    width: 28,
    height: 28,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.dark.accent,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: Colors.dark.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
  headerName: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.dark.text,
  },
  headerSub: {
    fontSize: 12,
    color: Colors.dark.textSecondary,
    flex: 1,
  },
  messagesScroll: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
  },
  inputArea: {
    borderTopWidth: 1,
    borderTopColor: Colors.dark.glassBorder,
    backgroundColor: Colors.dark.backgroundDefault,
  },
  usageBar: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  usageCount: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    textAlign: "right",
  },
  usageCapped: {
    fontSize: 11,
    color: "#FF007F",
    textAlign: "right",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  inputRowIos: {
    paddingBottom: Spacing.md,
  },
  inputRowAndroid: {
    paddingBottom: Spacing.lg,
  },
  input: {
    flex: 1,
    height: 44,
    backgroundColor: Colors.dark.backgroundSecondary,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.lg,
    fontSize: 14,
    color: Colors.dark.text,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.dark.accent,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  sendButtonDisabled: {
    opacity: 0.35,
  },
  inputDisabled: {
    opacity: 0.5,
  },
});
