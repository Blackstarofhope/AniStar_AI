# Overview

AniStar is a premium anime countdown and discovery mobile app built with React Native (Expo). The app targets Gen Z anime fans ("Otaku") who value aesthetics, performance, and hype. It features a dark cyberpunk-inspired design with neon accents, displaying upcoming anime releases with real-time countdown timers. The application fetches anime data from the Jikan API (MyAnimeList) and allows users to browse current season schedules, view detailed anime information, and manage favorites.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Framework**: React Native with Expo SDK 54, utilizing the new architecture and React Compiler for performance optimization.

**Navigation**: Stack-based navigation using `@react-navigation/native-stack`. The app features two primary screens:
- Home screen with filterable anime list by day of the week
- Detail screen for individual anime with comprehensive information

**State Management**: 
- React Query (`@tanstack/react-query`) for server state and API data caching
- React Context API for client-side state (favorites management)
- AsyncStorage for persistent local data (favorite anime)

**Styling System**: 
- Custom theme system with dark mode (mandatory)
- Cyberpunk aesthetic with deep dark backgrounds (#0F0F12) and neon accents (Electric Purple #A855F7, Cyan #00E5FF, Neon Pink #FF007F)
- Glassmorphism UI components with translucent effects
- StyleSheet-based styling (no inline styles)
- Linear gradients for backgrounds and overlays

**Animation**: React Native Reanimated v4 with worklets for high-performance animations, including spring-based interactions and shimmer loading effects.

**Component Architecture**: 
- Reusable themed components (ThemedText, ThemedView, Card, Button)
- Custom AnimeCard component with countdown timers that update every second
- Skeleton loaders for loading states
- Error boundaries for graceful error handling

**Image Handling**: Expo Image library for optimized image loading and caching with 2:3 aspect ratios for anime posters.

## Backend Architecture

**Server Framework**: Express.js server serving as a proxy/middleware layer between the mobile app and external APIs.

**API Design**: RESTful API structure with `/api` prefix for all routes. Currently configured with CORS for Replit deployment domains.

**Data Access Layer**: Abstract storage interface (`IStorage`) with in-memory implementation (`MemStorage`). Designed to support future database integration while maintaining clean separation of concerns.

**Environment-Aware Configuration**: Separate development and production modes with environment-specific URLs and CORS policies for Replit hosting.

## Data Storage Solutions

**Client-Side Persistence**: AsyncStorage for favorites and user preferences. Data is stored as JSON serialized objects.

**Database Schema**: Drizzle ORM with PostgreSQL dialect configured. Schema defines a `users` table with UUID primary keys, though the database is not currently active in favor of in-memory storage. The architecture supports easy migration to PostgreSQL when needed.

**Migration Strategy**: Drizzle Kit configured for schema migrations in the `/migrations` directory.

## External Dependencies

**Jikan API (MyAnimeList)**: Primary data source for anime information, schedules, and metadata. The app queries:
- Current season anime (`/seasons/now`)
- Anime schedules by day of the week (`/schedules/{day}`)
- Individual anime details (`/anime/{mal_id}`)

**Expo Services**:
- Expo Image for optimized image loading
- Expo Linear Gradient for UI effects
- Expo Blur for glassmorphism effects
- Expo Haptics for tactile feedback
- Expo Splash Screen for app initialization

**Date/Time Utilities**: `date-fns` library for all countdown logic, date parsing, and time calculations. Used extensively for computing next airing times from broadcast schedules.

**Icons**: Expo Vector Icons (Ionicons) for UI elements and navigation.

**Deployment Platform**: Replit-native deployment with environment variables for domain configuration (`REPLIT_DEV_DOMAIN`, `REPLIT_INTERNAL_APP_DOMAIN`).

**Build System**: 
- Expo Metro bundler for development
- esbuild for server production builds
- Custom build scripts for static web deployment

**Development Tools**:
- TypeScript for type safety
- ESLint with Expo configuration
- Prettier for code formatting
- Babel with module resolver for path aliases (`@/` for client, `@shared/` for shared code)