# Project Context
You are building "AniStar," a premium anime countdown and discovery mobile app.
The target audience is "Otaku," Gen Z, and hardcore anime fans who value aesthetics, performance, and "hype."

# Design Philosophy & Aesthetic (CRITICAL)
NEVER design a "corporate," "clean," or "white" UI.
ALWAYS default to the following aesthetic principles:

1.  **The "Dark & Neon" Theme:**
    * **Backgrounds:** Deep, dark colors (e.g., `#0F0F12`, `#1A1A2E`). Never use pure white backgrounds.
    * **Accents:** High-saturation "Cyberpunk" neons.
        * Primary: Electric Purple (`#A855F7`) or Neon Pink (`#FF007F`).
        * Secondary: Cyan/Teal (`#00E5FF`).
    * **Text:** High contrast white (`#FFFFFF`) or light grey (`#E0E0E0`) for readability.

2.  **UI Components (Glassmorphism):**
    * Use translucent, glass-like elements for cards and navigation bars (high opacity backgrounds with blur if possible).
    * Borders should be thin and subtle, using low-opacity white to mimic light catching an edge.

3.  **Imagery is King:**
    * Anime key visuals (posters) must be the focal point.
    * Use `resizeMode="cover"` and `2:3` aspect ratios for posters.
    * Add subtle shadows or glows behind images to make them "pop" off the screen.

# Technical Stack & Best Practices
* **Framework:** React Native (Expo) - Replit Template.
* **Styling:** `StyleSheet` (avoid inline styles). Use `expo-linear-gradient` for backgrounds.
* **Icons:** `@expo/vector-icons` (Ionicons).
* **Date Handling:** Use `date-fns` for all countdown logic.

# Behavior Rules
* **Loading States:** Never show a blank screen. Implement a "Skeleton Loader" with a dark grey shimmer.
* **Error States:** Write friendly, "anime-themed" error messages (e.g., "Connection severed," "Failed to summon data") rather than generic "Error 404."
