import React, { useState, useRef } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { useUser } from "@/contexts/UserContext";

type Mode = "signup" | "login";

export default function ProfileSetupScreen() {
  const { saveDisplayName, login } = useUser();
  const [mode, setMode] = useState<Mode>("signup");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinRef = useRef<TextInput>(null);

  const isSignup = mode === "signup";
  const canSubmit =
    name.trim().length >= 2 &&
    /^\d{4}$/.test(pin) &&
    !isSaving;

  function switchMode(next: Mode) {
    setMode(next);
    setName("");
    setPin("");
    setError(null);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setIsSaving(true);
    try {
      if (isSignup) {
        await saveDisplayName(name.trim(), pin);
      } else {
        const ok = await login(name.trim(), pin);
        if (!ok) {
          setError("Display name or PIN is incorrect.");
          setIsSaving(false);
          return;
        }
      }
    } catch (e: any) {
      if (e?.message === "taken") {
        setError("That display name is already taken. Pick another.");
      } else {
        setError("Something went wrong. Please try again.");
      }
      setIsSaving(false);
    }
  }

  return (
    <LinearGradient
      colors={["#0F0F12", "#1A0A2E", "#0F0F12"]}
      style={styles.gradient}
    >
      <SafeAreaView style={styles.safe}>
        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoRow}>
            <Image
              source={require("../../assets/images/icon.png")}
              style={styles.icon}
              resizeMode="contain"
            />
            <ThemedText style={styles.appName}>AniStar</ThemedText>
          </View>

          <ThemedText style={styles.heading}>
            {isSignup ? "Welcome" : "Sign In"}
          </ThemedText>
          <ThemedText style={styles.subheading}>
            {isSignup
              ? "Choose a display name and PIN so the community can see who discovered new anime."
              : "Enter your display name and PIN to restore your account."}
          </ThemedText>

          <View style={styles.inputWrapper}>
            <ThemedText style={styles.label}>Display name</ThemedText>
            <TextInput
              style={[styles.input, error ? styles.inputError : null]}
              value={name}
              onChangeText={(t) => { setName(t); setError(null); }}
              placeholder="e.g. CyberOtaku"
              placeholderTextColor={Colors.dark.tabIconDefault}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={32}
              returnKeyType="next"
              onSubmitEditing={() => pinRef.current?.focus()}
            />
          </View>

          <View style={styles.inputWrapper}>
            <ThemedText style={styles.label}>4-digit PIN</ThemedText>
            <TextInput
              ref={pinRef}
              style={[styles.input, error ? styles.inputError : null]}
              value={pin}
              onChangeText={(t) => { setPin(t.replace(/\D/g, "").slice(0, 4)); setError(null); }}
              placeholder="e.g. 1234"
              placeholderTextColor={Colors.dark.tabIconDefault}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
            {error ? (
              <ThemedText style={styles.errorText}>{error}</ThemedText>
            ) : (
              <ThemedText style={styles.hint}>
                {isSignup
                  ? "Remember your PIN — it's how you'll sign in again."
                  : "Enter the PIN you chose when you signed up."}
              </ThemedText>
            )}
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              !canSubmit && styles.buttonDisabled,
              pressed && canSubmit && styles.buttonPressed,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {isSaving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <ThemedText style={styles.buttonText}>
                {isSignup ? "Get Started" : "Sign In"}
              </ThemedText>
            )}
          </Pressable>

          <Pressable
            style={styles.switchLink}
            onPress={() => switchMode(isSignup ? "login" : "signup")}
          >
            <ThemedText style={styles.switchText}>
              {isSignup
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </ThemedText>
          </Pressable>
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl * 2,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.xl * 2,
  },
  icon: {
    width: 40,
    height: 40,
    marginRight: Spacing.sm,
  },
  appName: {
    fontSize: 28,
    fontWeight: "700",
    color: Colors.dark.accent,
    letterSpacing: 1,
  },
  heading: {
    fontSize: 30,
    fontWeight: "800",
    color: Colors.dark.text,
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  subheading: {
    fontSize: 15,
    color: Colors.dark.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing.xl * 2,
    paddingHorizontal: Spacing.md,
  },
  inputWrapper: {
    marginBottom: Spacing.xl,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.dark.textSecondary,
    marginBottom: Spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  input: {
    backgroundColor: Colors.dark.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.dark.glassBorder,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: 17,
    color: Colors.dark.text,
  },
  inputError: {
    borderColor: Colors.dark.neonPink,
  },
  hint: {
    fontSize: 12,
    color: Colors.dark.tabIconDefault,
    marginTop: Spacing.sm,
  },
  errorText: {
    fontSize: 13,
    color: Colors.dark.neonPink,
    marginTop: Spacing.sm,
  },
  button: {
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
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.3,
  },
  switchLink: {
    marginTop: Spacing.xl,
    alignItems: "center",
    paddingVertical: Spacing.sm,
  },
  switchText: {
    fontSize: 14,
    color: Colors.dark.accent,
    textDecorationLine: "underline",
  },
});
