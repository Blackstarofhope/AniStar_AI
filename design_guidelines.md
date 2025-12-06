# Anime Countdown App - Design Guidelines

## Primary Design Authority
**All design and technical decisions must strictly adhere to the rules defined in `AI_RULES.md`.** The guidelines below supplement those rules with app-specific specifications.

## Visual Design System

### Color Palette
- **Background**: `#0F0F12` (primary dark background - mandatory)
- **Theme**: Dark mode with premium aesthetic
- Follow all color specifications defined in `AI_RULES.md`

### Typography
- Anime titles should be prominent and readable against dark backgrounds
- Countdown timers should use clear, legible fonts
- Refer to `AI_RULES.md` for complete typography specifications

### Components

#### Anime Card
- **Layout**: Vertical card design in scrollable list
- **Cover Image**: Display anime cover art prominently
- **Title**: Show anime title clearly
- **Countdown Timer**: Live timer displaying format "Airs in: XXd XXh XXm"
  - Updates every second for real-time accuracy
  - Should be visually prominent
- **Visual Treatment**: Apply gradient overlays as specified in `AI_RULES.md`
- **Spacing**: Cards should have comfortable spacing for easy scanning

#### Loading States
- **Skeleton Loader**: Shimmer effect during data fetching
- Maintain the #0F0F12 background during loading
- Shimmer animation should feel premium and smooth

## Layout Architecture

### Home Screen
- **Structure**: Single screen with vertical scroll list
- **Content**: Anime cards displaying current season schedule
- **Safe Areas**: Respect device safe area insets (top notch, bottom indicator)
- **Scroll Behavior**: Smooth, natural scrolling with proper momentum

### Navigation
- Stack-only navigation (single screen for initial implementation)
- No tab bar or drawer needed for this phase

## Interaction Design
- **Timer Updates**: Countdown refreshes every 1 second
- **Touch Feedback**: Follow specifications in `AI_RULES.md` for all touchable elements
- **Loading Experience**: Immediate shimmer skeleton display while fetching API data

## Technical Requirements
- JST to local timezone conversion for accurate air times
- Handle loading, error, and empty states gracefully
- Optimize list rendering for performance with potentially long anime lists

## Data Display
- Fetch from Jikan API: `https://api.jikan.moe/v4/schedules`
- Filter for current season/now airing anime
- Display anime cover, title, and calculated countdown

## Accessibility
- Ensure countdown timers are readable
- Maintain sufficient contrast for text on dark backgrounds
- Support dynamic type if specified in `AI_RULES.md`

---

**Note**: These guidelines are supplementary to `AI_RULES.md`. In case of any conflict, `AI_RULES.md` takes precedence. All aesthetic decisions, technical patterns, component styling, and interaction behaviors must strictly follow the rules defined in that file.