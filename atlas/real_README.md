# Atlas AAC — Real Architecture

This document describes **what the code currently does**. It intentionally ignores the older root `README.md`, which is an aspirational concept document containing features that are not implemented.

Atlas is an Expo/React Native AAC (Augmentative and Alternative Communication) prototype. It provides a tile-based sentence builder, a drawing/photo board, a browser-based speech-to-tiles conversation view, and optional emotion-aware speech.

This is a prototype, not a clinically validated AAC device. AI suggestions are assistive prompts, not guaranteed interpretations of a user's intent.

---

## 1. Stack

| Area | Implementation |
|---|---|
| App framework | Expo SDK 58, React Native 0.88, React 19.3 |
| Routing | Expo Router file-based routes |
| Language | TypeScript, `strict: true` |
| Client state | Zustand (in memory) |
| Auth | Firebase Authentication with Google |
| Local persistence | AsyncStorage |
| Drawing | `react-native-svg` |
| Camera / photos | `expo-image-picker` |
| Speech output | ElevenLabs API (`eleven_v3`), `expo-audio`, and `expo-speech` |
| Speech input | Browser Web Speech API only |
| Emotion detection | `face-api.js` in a browser or WebView |
| Symbols | OpenSymbols API |
| AI | OpenRouter chat/vision models |
| Translation | Local HTTP service at `http://localhost:8244/translate` |

There is **no application backend** in this repository. The client calls external APIs directly.

---

## 2. Repository layout

```text
software_project/
├── AGENTS.md
├── README.md              # old concept document; not the source of truth
├── real_README.md         # this file
└── atlas/
    ├── app/               # Expo Router routes
    │   ├── _layout.tsx    # fonts, theme, auth gate
    │   ├── login.tsx
    │   ├── (tabs)/
    │   │   ├── _layout.tsx
    │   │   ├── index.tsx      # Speak
    │   │   ├── board.tsx      # Board
    │   │   ├── transcribe.tsx # Listen
    │   │   ├── settings.tsx
    │   │   └── emotions.tsx   # hidden debug route
    │   ├── debug.tsx
    │   └── modal.tsx
    ├── components/        # shared UI and board/emotion components
    ├── constants/         # colors, layout, tiles.json, tile builder
    ├── state/             # Zustand stores and auth provider
    ├── services/          # OpenRouter, ElevenLabs, Firebase, OpenSymbols, ASR
    ├── utils/             # suggestions, translation, drawing capture
    └── config/api.ts      # API keys, endpoints, board model
```

---

## 3. App shell and routes

```text
app/_layout.tsx
  ├─ load Fredoka + OpenDyslexic + Calibri fonts
  ├─ ThemeProvider
  └─ AuthProvider (Firebase onAuthStateChanged)
       │
       ├─ no user ──> /login
       └─ user ─────> /(tabs)
                        ├─ Speak      (index)
                        ├─ Board
                        ├─ Listen     (transcribe)
                        ├─ Settings
                        └─ Emotions   (hidden tab route)
                      /debug
                      /modal
```

`app/_layout.tsx` protects all signed-in routes with `Stack.Protected`. The login screen uses Google sign-in:

- Web: Firebase `signInWithPopup`
- Native: `@react-native-google-signin/google-signin`, then Firebase credential sign-in
- Native Google sign-in requires a development/native build; it does not work in Expo Go

Firebase web configuration is hardcoded in `atlas/services/firebase.ts`. The only Firebase-related environment value is `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.

---

## 4. Tile data and state

### Tile model

`atlas/constants/tiles.json` contains:

- 64 core tiles
- 1,012 general words
- 1 general-words folder
- 2 letter buckets: `A–M` and `N–Z`

`atlas/constants/tiles.ts` converts this into `Tile` objects:

```ts
type Tile = {
  id: string;
  label: string;
  color: string;
  wordType?: string;
  parentId?: string;
  isFolder?: boolean;
  speechText?: string;
  imageUrl?: string;
};
```

General words are lazy-loaded by bucket when a folder is opened or when a transcript needs a word from that bucket. The app does not load all 1,012 general words at startup.

### Zustand stores

```text
tiles.json
   │
   ▼
constants/tiles.ts ──> initialTiles
                         │
                         ▼
                  useAacStore (Zustand)
                  ├─ tiles
                  ├─ sentence
                  ├─ folderPath
                  └─ suggestions
                         │
                         ▼
                  Speak / Board / Listen screens

useSettingsStore (Zustand)
├─ emotionFeatureEnabled
├─ dyslexicFontEnabled
├─ selectedLanguage
└─ translatedTiles
```

**Important:** both Zustand stores are memory-only. Tiles, sentence, folder position, language, and translated tiles reset when the app reloads. Only these are persisted:

| Data | Storage |
|---|---|
| Saved conversations | AsyncStorage key `transcribe.conversations` |
| OpenSymbols symbol cache | AsyncStorage key `opensymbols_cache` |
| OpenSymbols token cache | AsyncStorage key `opensymbols_token` |
| Board interpretation cache | In-memory `Map` (max 20) |
| Auth session | Firebase SDK persistence |

### Deterministic suggestions

`utils/suggestions.ts` is not a learned model. It returns:

1. Sibling tiles from the same folder as the last selected tile
2. A fixed fallback list: `please`, `help`, `more`, `stop`, `yes`, `no`, `go`, `want`
3. At most 8 suggestions

The Speak screen may replace these with OpenRouter suggestions, but falls back to the deterministic list.

---

## 5. Speak screen

File: `atlas/app/(tabs)/index.tsx`

```text
┌──────────────────────────────────────────────┐
│ SPEAK sentence bar                           │
│  [tile] [tile] [tile]        [speak] [undo]  │
├──────────────────────────────────────────────┤
│ suggestion tiles                             │
├──────────────────────────────────────────────┤
│ folder breadcrumb                            │
│ tile grid (folders + words + symbols)        │
└──────────────────────────────────────────────┘
```

### Tap a tile

```text
tap tile
  ├─ if folder: open folder / lazy-load its words
  └─ if word:
       ├─ expo-speech speaks the tile label
       └─ add tile to sentence
            └─ recompute local suggestions
```

### Speak the sentence

```text
tap sentence / speak button
  └─ build text from tile.speechText ?? tile.label
       ├─ camera emotion active and confidence > 45?
       │    └─ use camera emotion
       └─ otherwise
            └─ OpenRouter detectEmotion(text)
       └─ ElevenLabs TTS
            ├─ model: eleven_v3
            ├─ optional emotion audio tag
            ├─ cache: last 20 audio blobs
            └─ playback: HTML5 Audio (web) / expo-audio (native)
```

If ElevenLabs fails, the screen shows an alert. Tile taps still use native `expo-speech`.

### AI next-word suggestions

When the sentence changes, the screen waits 300 ms and calls:

```text
OpenRouter suggestNextWords(sentence, tiles)
  -> 5 labels
  -> keep only labels that exist in the current tile set
  -> fallback to local suggestions on failure
```

Default chat model in `services/openrouter.ts`:

```text
dots-studio/dots-3-note-preview:free
```

This is a text model. Board interpretation uses a separate vision model.

---

## 6. Board screen

File: `atlas/app/(tabs)/board.tsx`

The board is a pannable canvas with these modes:

- **draw** — freehand strokes with color and width
- **erase** — remove strokes or placed items
- **select** — move/resize tiles and photos
- **pan** — move the canvas

It supports:

- freehand drawing (`react-native-svg`)
- placed AAC tiles
- placed photos from gallery or camera
- undo and clear
- interpreting the board into possible AAC phrases

There is no pinch-zoom implementation; `scale` is currently fixed at 1.

### Board interpretation flow

```text
child draws / adds tiles / adds photos
                │
                ▼
        tap "Interpret"
                │
                ├─ tiles only?
                │     │
                │     ▼
                │  cheap text model
                │  google/gemini-2.5-flash-lite
                │  "I → water" -> "I want water"
                │
                └─ drawing/photos?
                      │
                      ▼
                build board fingerprint
                      ├─ cache hit? -> show cached result
                      ▼
                capture drawing
                ├─ web: SVG -> canvas -> JPEG (512–1024 px)
                └─ native: BoardSnapshot -> PNG
                      │
                      ▼
                OpenRouter vision model
                google/gemini-3.1-flash-lite
                      │
                      ▼
        structured JSON:
        {
          interpretations: [
            { phrase, concept, confidence }
          ],
          uncertain: boolean
        }
                      │
                      ▼
        "What you might mean" modal
        ├─ tap a phrase -> ElevenLabs speaks it
        ├─ low confidence -> "I'm not sure" + "Try again"
        └─ never auto-speaks
```

Implementation details:

- Tile-only boards use a **text-only cheap model** to expand telegraphic sequences. No image is captured or uploaded.
- Tile-only fallback: if the model call fails, the exact tile sequence is shown with `uncertain: true`.
- At most 2 photos are sent for drawing/photo boards.
- The drawing is cropped to its content bounds.
- Web sends JPEG; native sends PNG.
- Results are cached by a fingerprint of strokes, tiles, and images.
- Uncertain results are not cached, so “Try again” can re-query.
- In-flight requests for the same board are deduplicated.
- A stale response is ignored if the board changes while the request is running.

The board does **not** use Jev. Jev is a typed decision model and cannot generate arbitrary AAC phrases. Tile expansion uses a cheap text chat model; drawing interpretation uses a vision-capable chat model.

---

## 7. Listen / Transcribe screen

File: `atlas/app/(tabs)/transcribe.tsx`

This is a speech-to-tiles conversation view, not an audio recorder.

```text
tap microphone
  -> browser Web Speech API
  -> interim transcript
  -> final transcript
       ├─ ensureWordsLoaded(words)
       ├─ simplifySentence(transcript, availableTiles) via OpenRouter
       ├─ map simplified words to Tile objects
       ├─ suggestReply(transcript, availableTiles) via OpenRouter
       └─ append message to conversation
```

Conversation messages contain:

```ts
{
  id, type: 'incoming' | 'outgoing',
  original, simplified, tiles, timestamp,
  emotion?, emotionConfidence?
}
```

Saved conversations:

- AsyncStorage key: `transcribe.conversations`
- Maximum 50
- Auto-saved when leaving the screen with messages
- Loaded when the screen mounts
- List title says “recordings,” but **no audio is stored or replayable**

### Platform support

`services/speechRecognition.ts` checks for:

```text
window.SpeechRecognition || window.webkitSpeechRecognition
```

| Platform | Listen support |
|---|---|
| Chrome / Edge | Works (microphone permission required) |
| Safari | Partial / version-dependent |
| Firefox | Not supported |
| iOS / Android native | Not supported; “New Transcription” is disabled |

The feature is effectively **web-only** right now.

---

## 8. Emotion detection

The app has two emotion paths.

### 1. Text emotion for TTS

`services/openrouter.ts` → `detectEmotion(sentence)` asks a text model for one of:

```text
neutral, happy, sad, excited, angry, calm, curious, thoughtful
```

This is used when the camera is not active.

### 2. Camera emotion

`components/EmotionCameraBadge.tsx` renders a hidden `EmotionDetector` when active.

- Web: `EmotionDetector.web.tsx` loads `@vladmandic/face-api` from jsDelivr, uses the webcam, and classifies expressions.
- Native: `EmotionDetector.tsx` embeds the same browser logic in a `react-native-webview`.
- Detection runs at roughly 3 FPS.
- Results are smoothed over a short history.
- The detected emotion is passed into ElevenLabs as an audio tag.

```text
camera -> face-api.js -> emotion + confidence
                         │
                         ▼
                EmotionCameraBadge
                         │
                         ▼
                ElevenLabs [emotion] tag
```

This is not native ML and requires internet access for the face-api script/models.

---

## 9. External services

```text
                         ┌────────────────────┐
                         │   Atlas client     │
                         │ Expo / RN / web    │
                         └─────────┬──────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
        ▼                          ▼                          ▼
┌───────────────┐        ┌──────────────────┐       ┌────────────────┐
│ OpenRouter    │        │ ElevenLabs       │       │ OpenSymbols    │
│ chat + vision │        │ TTS (eleven_v3)  │       │ symbol images  │
└───────────────┘        └──────────────────┘       └────────────────┘
        │                          │                          │
        ▼                          ▼                          ▼
┌───────────────┐        ┌──────────────────┐       ┌────────────────┐
│ Firebase Auth │        │ face-api.js CDN  │       │ localhost:8244 │
│ Google sign-in│        │ emotion models   │       │ translation    │
└───────────────┘        └──────────────────┘       └────────────────┘
```

| Service | Used for | Notes |
|---|---|---|
| OpenRouter | next-word suggestions, transcript simplification, reply suggestions, emotion classification, tile expansion, board vision | Client-side API key; separate cheap text and vision models |
| ElevenLabs | full-sentence expressive speech | `eleven_v3`, 20-blob memory cache |
| OpenSymbols | tile/emotion symbol images | AsyncStorage cache, token is the secret itself |
| Firebase | Google authentication | Web config hardcoded; native needs dev build |
| face-api.js | camera emotion detection | Loaded from jsDelivr at runtime |
| localhost:8244 | English→Hindi tile translation | Separate local service; falls back to original text |

---

## 10. Translation and language

Settings currently offers English and Hindi.

```text
selectedLanguage === 'en'
  -> translatedTiles = []
  -> sentence reset

selectedLanguage === 'hi'
  -> translateTiles(initialTiles, 'hi')
  -> POST http://localhost:8244/translate
  -> translatedTiles stored in Zustand
  -> sentence reset
```

`utils/translation.ts` sends:

```json
{
  "data": "text",
  "from_lang": "en",
  "to_lang": "hi"
}
```

and expects `{ "translated": "..." }`. If the local service is unavailable, it returns the original text. There is no deployed translation backend in this repository.

---

## 11. Persistence and privacy

```text
In memory (lost on reload):
  tiles, sentence, folder path, suggestions,
  settings, translated tiles, board interpretation cache,
  ElevenLabs audio blob cache

Persisted locally:
  saved conversations (AsyncStorage)
  OpenSymbols symbol/token cache (AsyncStorage)
  Firebase auth session

Sent to external services:
  tile labels / sentence text -> OpenRouter, ElevenLabs
  drawing image + up to 2 photos -> OpenRouter
  speech audio -> browser speech service (Web Speech API)
  camera frames -> face-api.js in the browser/WebView
  symbol queries -> OpenSymbols
```

Security notes:

- `EXPO_PUBLIC_*` values are embedded in the client bundle.
- The app currently calls OpenRouter, ElevenLabs, and OpenSymbols directly from the client.
- `config/api.ts` logs the first 20 characters of configured keys.
- `services/opensymbols.ts` logs the token length and prefix.
- For production, move paid API calls behind a backend proxy and remove key logging.

---

## 12. Setup

```sh
cd atlas

# This project uses the Bun lockfile.
bun install --frozen-lockfile

cp .env.example .env.local
# fill in real values

npm run web       # web target
npm run start     # Expo/Metro
npm run android   # native Android build
npm run ios       # native iOS build
```

There are **no `test`, `lint`, or `typecheck` scripts** in `package.json`.

### Environment variables

See `atlas/.env.example`.

| Variable | Required | Purpose |
|---|---|---|
| `EXPO_PUBLIC_OPENROUTER_API_KEY` | Yes for AI | Suggestions, transcript mapping, replies, emotion, board vision |
| `EXPO_PUBLIC_BOARD_INTERPRETATION_MODEL` | Optional | Overrides the default vision model `google/gemini-3.1-flash-lite` |
| `EXPO_PUBLIC_TILE_INTERPRETATION_MODEL` | Optional | Overrides the default tile-only text model `google/gemini-2.5-flash-lite` |
| `EXPO_PUBLIC_OPENSYMBOLS_SECRET` | Yes for symbols | OpenSymbols access token |
| `EXPO_PUBLIC_ELEVENLABS_API_KEY` | Yes for expressive TTS | ElevenLabs speech |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Native Google sign-in | OAuth web client ID |
| `OPENROUTER_API_KEY` | Evaluation script only | `scripts/evaluate-board-drawing.mjs`; not bundled |

Firebase web configuration is not read from environment variables; it is hardcoded in `services/firebase.ts`.

---

## 13. Implemented vs not implemented

### Implemented

- Google authentication with protected routes
- AAC tile sentence builder with folders and lazy general-word loading
- Deterministic suggestions plus optional OpenRouter next-word suggestions
- Expressive ElevenLabs TTS and native `expo-speech` for tile taps
- Drawing, erasing, panning, tile placement, photo placement, undo, clear
- Tile-only board expansion through a cheap text model
- Vision-based board interpretation with confidence and uncertainty UI
- Browser speech-to-tiles conversation view
- Saved conversation history (text only)
- Camera emotion detection via face-api.js
- English/Hindi translation attempt through a local service
- OpenSymbols symbol lookup and caching

### Not implemented

- Collaborative filtering, Markov prediction, RLHF, Bayesian knowledge tracing
- GPS/geofence/BLE context detection
- Festival calendar intelligence
- Federated learning, cloud sync, automated retraining, A/B testing
- Parent/teacher analytics dashboard
- Native speech recognition
- Persistent tiles, sentence, folder path, or settings
- Offline AI or on-device sketch recognition
- A production backend or API proxy
- Board pinch-zoom
- A visible OpenDyslexic toggle in Settings (font support exists, but the switch is not rendered)
- Working `mapTranscriptToTiles` integration (function exists but is unused)
- A real test/lint pipeline

### Known dead or placeholder code

- `services/ai.ts` — placeholder, unused
- `components/DrawingCanvas.tsx` — unused
- `describeBoardContent()` in `components/InfiniteBoard.tsx` — exported but no longer used by the Board screen
- `utils/suggestions.ts` — used, but deterministic only
- `components/__tests__/StyledText-test.js` — default snapshot test; no test script
- `@tanstack/react-query` — installed but unused

---

## 14. Quick mental model

```text
Speak:
  tiles -> sentence -> local/AI suggestions -> ElevenLabs speech

Board:
  tiles only -> cheap text model -> phrase choices
  drawing/photos -> vision model -> phrase choices
  -> child selects -> ElevenLabs speech

Listen:
  microphone -> Web Speech API -> transcript -> OpenRouter
  -> AAC tiles + reply suggestions -> saved text conversation

Settings:
  language -> local translation service
  emotion toggle -> camera emotion badge
  auth -> Firebase Google sign-in

State:
  Zustand = current session only
  AsyncStorage = conversations + OpenSymbols cache
  External APIs = AI, speech, symbols, auth
```
