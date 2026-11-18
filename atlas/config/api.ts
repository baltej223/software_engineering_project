// API Configuration
// Load from environment variables (set in .env.local)
// See .env.example for template

export const API_KEYS = {
  OPENROUTER: process.env.EXPO_PUBLIC_OPENROUTER_API_KEY || "",
  OPENSYMBOLS_SECRET: process.env.EXPO_PUBLIC_OPENSYMBOLS_SECRET || "",
  ELEVENLABS: process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY || "",
};

// Debug: Log keys to console on initialization
if (typeof window !== 'undefined') {
  console.log("[API Config] Environment variables loaded:");
  console.log("[API Config] EXPO_PUBLIC_OPENROUTER_API_KEY:", process.env.EXPO_PUBLIC_OPENROUTER_API_KEY ? `${process.env.EXPO_PUBLIC_OPENROUTER_API_KEY.substring(0, 20)}...` : "NOT SET");
  console.log("[API Config] EXPO_PUBLIC_OPENSYMBOLS_SECRET:", process.env.EXPO_PUBLIC_OPENSYMBOLS_SECRET ? `${process.env.EXPO_PUBLIC_OPENSYMBOLS_SECRET.substring(0, 20)}...` : "NOT SET");
  console.log("[API Config] EXPO_PUBLIC_ELEVENLABS_API_KEY:", process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY ? `${process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY.substring(0, 20)}...` : "NOT SET");
}

if (
  !API_KEYS.OPENROUTER ||
  !API_KEYS.OPENSYMBOLS_SECRET ||
  !API_KEYS.ELEVENLABS
) {
  console.warn(
    "⚠️ Missing API keys. Copy .env.example to .env.local and fill in your keys."
  );
}

export const API_ENDPOINTS = {
  OPENROUTER: "https://openrouter.ai/api/v1",
  OPENSYMBOLS: "https://www.opensymbols.org/api/v2",
  ELEVENLABS: "https://api.elevenlabs.io/v1",
};

/**
 * Vision model used for Board drawing interpretation. Keep this overridable
 * so the model can be changed without touching the Board screen.
 *
 * Jev is intentionally not the default: it returns typed decisions, not AAC
 * phrases, and its image input is still marked experimental by TypeSafe.
 */
export const BOARD_INTERPRETATION_MODEL =
  process.env.EXPO_PUBLIC_BOARD_INTERPRETATION_MODEL ||
  "google/gemini-3.1-flash-lite";

/**
 * Text-only model used to expand an incomplete tile sequence into phrases.
 * This task is simple enough for a cheap flash-lite model; no image is sent.
 */
export const TILE_INTERPRETATION_MODEL =
  process.env.EXPO_PUBLIC_TILE_INTERPRETATION_MODEL ||
  "google/gemini-2.5-flash-lite";
