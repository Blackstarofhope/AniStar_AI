import { Platform } from "react-native";

const primaryAccent = "#A855F7";
const secondaryAccent = "#00E5FF";
const neonPink = "#FF007F";

export const Colors = {
  light: {
    text: "#FFFFFF",
    textSecondary: "#E0E0E0",
    buttonText: "#FFFFFF",
    tabIconDefault: "#687076",
    tabIconSelected: primaryAccent,
    link: primaryAccent,
    backgroundRoot: "#0F0F12",
    backgroundDefault: "#1A1A2E",
    backgroundSecondary: "#252540",
    backgroundTertiary: "#2F2F4A",
    accent: primaryAccent,
    accentSecondary: secondaryAccent,
    neonPink: neonPink,
    glassBorder: "rgba(255, 255, 255, 0.1)",
    shimmer: "#2A2A40",
  },
  dark: {
    text: "#FFFFFF",
    textSecondary: "#E0E0E0",
    buttonText: "#FFFFFF",
    tabIconDefault: "#9BA1A6",
    tabIconSelected: primaryAccent,
    link: primaryAccent,
    backgroundRoot: "#0F0F12",
    backgroundDefault: "#1A1A2E",
    backgroundSecondary: "#252540",
    backgroundTertiary: "#2F2F4A",
    accent: primaryAccent,
    accentSecondary: secondaryAccent,
    neonPink: neonPink,
    glassBorder: "rgba(255, 255, 255, 0.1)",
    shimmer: "#2A2A40",
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 48,
  inputHeight: 48,
  buttonHeight: 52,
};

export const BorderRadius = {
  xs: 8,
  sm: 12,
  md: 18,
  lg: 24,
  xl: 30,
  "2xl": 40,
  "3xl": 50,
  full: 9999,
};

export const Typography = {
  h1: {
    fontSize: 32,
    fontWeight: "700" as const,
  },
  h2: {
    fontSize: 28,
    fontWeight: "700" as const,
  },
  h3: {
    fontSize: 24,
    fontWeight: "600" as const,
  },
  h4: {
    fontSize: 20,
    fontWeight: "600" as const,
  },
  body: {
    fontSize: 16,
    fontWeight: "400" as const,
  },
  small: {
    fontSize: 14,
    fontWeight: "400" as const,
  },
  link: {
    fontSize: 16,
    fontWeight: "400" as const,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
