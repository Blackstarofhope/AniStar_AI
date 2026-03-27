# Overview

AniStar is a premium AI-powered anime countdown and discovery mobile app built with React Native (Expo). The app targets Gen Z anime fans ("Otaku") who value aesthetics, performance, and hype. It features a dark cyberpunk-inspired design with neon accents, displaying upcoming anime releases with real-time countdown timers AND personalized AI recommendations powered by a Forward-Forward neural network.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

**Framework**: React Native with Expo SDK 54, utilizing the new architecture and React Compiler for performance optimization.

**Navigation**: Bottom tab navigation with two tabs, each containing a stack navigator:
- **Schedule tab**: HomeScreen (day-of-week filter tabs with anime cards) → AnimeDetailScreen
- **For You tab**: RecommendationsScreen (AI-powered recommendations) → AnimeDetailScreen
- Navigation files: `client/navigation/TabNavigator.tsx`, `client/navigation/RootStackNavigator.tsx`, `client/navigation/types.ts`

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
- RecommendationCard component with confidence scores, artwork verification badges, and inline thumbs-up/down rating
- AIStatusModal component showing live neural network metrics (goodness history sparkline, Kuramoto sync, EWC penalty, neurogenesis events)
- Skeleton loaders for loading states
- Error boundaries for graceful error handling

**Image Handling**: Expo Image library for optimized image loading and caching with 2:3 aspect ratios for anime posters.

## Backend Architecture

**Server Framework**: Express.js server serving as a proxy/middleware layer between the mobile app and external APIs.

**API Design**: RESTful API structure with `/api` prefix for all routes. Currently configured with CORS for Replit deployment domains.
- `GET /api/anime/schedule?day=<day>` — daily anime schedule (proxied from Jikan)
- `GET /api/anime/seasonal` — current season anime
- `GET /api/anime/:id` — anime details (enriched with AniList)
- `GET /api/ai/recommend?limit=N` — AI-personalized recommendations
- `POST /api/ai/feedback` — submit thumbs-up/down rating to train the model
- `GET /api/ai/status` — live neural network health metrics
- `POST /api/ai/verify-artwork` — verify anime artwork URL

**Data Access Layer**: Abstract storage interface (`IStorage`) with in-memory implementation (`MemStorage`). Designed to support future database integration.

**Environment-Aware Configuration**: Separate development and production modes with environment-specific URLs and CORS policies for Replit hosting.

## AI Engine (server/ai/)

The core of the personalization system — all implemented in pure TypeScript, no ML library dependencies.

### Forward-Forward Network (`forwardForward.ts`)
- Implements Hinton 2022 Forward-Forward algorithm: NO backpropagation
- Each layer locally trains by maximizing goodness on positive data and minimizing on corrupted/negative data
- Architecture: [72, 96, 48, 24] neurons across 4 layers (customizable via neurogenesis)
- Goodness function: sum of squared activations per layer
- Uses layer normalization and ReLU activations
- Stores goodness history for diagnostics

### Kuramoto Coupling Layer (`kuramoto.ts`)
- Phase oscillators (textPhases, visionPhases) synchronize text and vision embedding spaces
- 96 coupled oscillators with configurable natural frequencies
- Coupling strength K updated by FF goodness signal
- `phaseModulatedEmbedding()` applies phase weights to embedding vectors
- Synchrony index (order parameter) tracked over time

### Neurogenesis Engine (`neurogenesis.ts`)
- Grows layers 20% when goodness < θ_low for 5 consecutive epochs
- Prunes layers 10% when goodness > θ_high for 5 consecutive epochs
- Tracks growth/prune event counts for diagnostics

### EWC + Replay Buffer (`ewc.ts`)
- Elastic Weight Consolidation for continual/lifelong learning
- Fisher information matrix computed from recent ratings to protect important weights
- Reservoir replay buffer (max 500 entries, random eviction)
- Prevents catastrophic forgetting of past preferences

### Text Embedding Pipeline (`textEmbedder.ts`)
- 72-dimensional genre + score + episode count + studio embedding
- TF-IDF weighting for genre vectors across the current anime catalog
- Supports `embedAnime()`, `tfidfWeight()`, `buildUserPreferenceVector()`
- EMBEDDING_DIM = 50 genres + 1 score + 1 eps + 20 studios = 72

### Vision/Artwork Verifier (`visionVerifier.ts`)
- HTTP HEAD request validates image URL (content-type, size)
- Perceptual hash computed via crypto for cache deduplication
- No external model download required
- Results cached 30 minutes

### Anime Data Service (`animeData.ts`)
- Jikan API (MyAnimeList) for schedules and anime details
- AniList GraphQL API for enrichment (genres, studio, score)
- 30-minute in-memory cache for all data
- `getAllCurrentAnime()` aggregates seasonal + all 7 daily schedules (deduped)

### Model Store (`modelStore.ts`)
- Persists full model state to `ai-model-state.json` in project root
- Version-checked (version=2) to handle breaking schema changes
- Loads/saves: FF network weights, Kuramoto state, neurogenesis state, EWC fisher matrix, replay buffer, rating history, all anime embeddings

### Recommendation Engine (`recommendEngine.ts`)
- Scores anime with: 60% FF network goodness + 40% cosine similarity to user preference vector
- Applies Kuramoto phase modulation before scoring
- Artwork verification boosts/penalizes confidence scores
- Calls Kuramoto step and neurogenesis check on every training pass

## Data Storage Solutions

**Client-Side Persistence**: AsyncStorage for favorites and user preferences. Data is stored as JSON serialized objects.

**AI Model Persistence**: `ai-model-state.json` in project root — full network weights, optimizer state, Kuramoto phases, EWC Fisher matrices, and replay buffer.

**Database Schema**: Drizzle ORM with PostgreSQL dialect configured. Schema defines a `users` table with UUID primary keys, though the database is not currently active.

## External Dependencies

**Jikan API (MyAnimeList)**: Primary data source for anime information, schedules, and metadata.
- Current season anime (`/seasons/now`)
- Anime schedules by day of the week (`/schedules/{day}`)
- Individual anime details (`/anime/{mal_id}/full`)

**AniList GraphQL API**: Secondary enrichment source for more complete genre/studio/score data.

**Expo Services**:
- Expo Image for optimized image loading
- Expo Linear Gradient for UI effects
- Expo Blur for glassmorphism effects
- Expo Haptics for tactile feedback
- Expo Splash Screen for app initialization

**Date/Time Utilities**: `date-fns` library for all countdown logic, date parsing, and time calculations.

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
