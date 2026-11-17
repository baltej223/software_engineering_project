import {
  API_ENDPOINTS,
  API_KEYS,
  BOARD_INTERPRETATION_MODEL,
} from "@/config/api";
import type { PlacedImage, PlacedTile, Stroke } from "@/components/InfiniteBoard";
import { createDeferred } from "@/utils/deferred";

export type BoardInterpretation = {
  phrase: string;
  concept: string;
  confidence: number;
};

export type BoardInterpretationResult = {
  interpretations: BoardInterpretation[];
  uncertain: boolean;
};

export type BoardInterpretationInput = {
  fingerprint: string;
  drawingDataUrl?: string;
  photoDataUrls?: string[];
  tileLabels?: string[];
};

type ImageContent = {
  type: "image_url";
  image_url: { url: string };
};

type TextContent = {
  type: "text";
  text: string;
};

type ChatContent = TextContent | ImageContent;

type ChatMessage = {
  role: "system" | "user";
  content: string | ChatContent[];
};

const CACHE_LIMIT = 20;
const MAX_INTERPRETATIONS = 3;
const MIN_CONFIDENCE = 0.3;
const UNCERTAIN_THRESHOLD = 0.45;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PHOTOS = 2;

const cache = new Map<string, BoardInterpretationResult>();
const inFlight = new Map<string, Promise<BoardInterpretationResult>>();

export const BOARD_INTERPRETATION_SYSTEM_PROMPT = `You interpret a child's AAC board drawing. The child may have drawn an object to communicate a need or feeling.

Return JSON only, with this exact shape:
{"interpretations":[{"phrase":"I want water","concept":"water","confidence":0.84}],"uncertain":false}

Rules:
- First identify only what is clearly visible. Do not invent objects, text, or details.
- Then propose up to 3 short, first-person AAC phrases (2-6 words) the drawing could communicate. Return fewer when only one or two are well supported.
- Phrases must be natural and age-appropriate. Do not claim certainty about the child's intent.
- A clearly drawn object may support a common need (water → "I am thirsty"). That is allowed; do not add unseen specifics.
- Prefer a general phrase over a specific guess. If the drawing shows a container but not what is inside, say "I want a drink", not "I want juice".
- Do not invent a specific substance, flavor, person, or place unless the drawing clearly shows it.
- Treat the child's placed word tiles as authoritative context. Preserve their meaning and order.
- If the drawing is ambiguous, incomplete, or unrecognizable, return fewer phrases and set "uncertain": true.
- "concept" is the visible object or idea the phrase is based on (for example "water", "sun", "food").
- "confidence" is a number from 0 to 1 for that phrase.
- Do not output explanations, headings, markdown, or anything outside the JSON object.`;

export class BoardInterpretationError extends Error {
  code:
    | "missing_key"
    | "timeout"
    | "rate_limited"
    | "api"
    | "invalid_response";

  constructor(
    code: BoardInterpretationError["code"],
    message: string
  ) {
    super(message);
    this.name = "BoardInterpretationError";
    this.code = code;
  }
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(36)}-${value.length.toString(36)}`;
}

/**
 * Stable fingerprint of everything that changes the interpretation. It is
 * intentionally based on board content, not on the rendered image bytes, so
 * unchanged boards hit the cache without re-encoding an image.
 */
export function createBoardFingerprint(input: {
  strokes: Stroke[];
  placedTiles: PlacedTile[];
  placedImages: PlacedImage[];
}): string {
  const strokes = input.strokes
    .map(
      (stroke) =>
        `${stroke.id}:${stroke.color}:${stroke.width}:${stroke.points
          .map((point) => `${roundCoordinate(point.x)},${roundCoordinate(point.y)}`)
          .join(";")}`
    )
    .join("|");

  const tiles = input.placedTiles
    .map(
      (placed) =>
        `${placed.id}:${placed.tile.id}:${placed.tile.label}:${roundCoordinate(
          placed.x
        )},${roundCoordinate(placed.y)}`
    )
    .join("|");

  const images = input.placedImages
    .map(
      (image) =>
        `${image.id}:${image.uri}:${roundCoordinate(image.x)},${roundCoordinate(
          image.y
        )},${roundCoordinate(image.width)},${roundCoordinate(image.height)}`
    )
    .join("|");

  return hashString(`${strokes}\n${tiles}\n${images}`);
}

export function getCachedBoardInterpretation(
  fingerprint: string
): BoardInterpretationResult | null {
  return cache.get(`${BOARD_INTERPRETATION_MODEL}:${fingerprint}`) ?? null;
}

function remember(key: string, result: BoardInterpretationResult): void {
  cache.set(key, result);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = createDeferred<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function fetchWithTimeout(
  body: string,
  headers: Record<string, string>
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(`${API_ENDPOINTS.OPENROUTER}/chat/completions`, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new BoardInterpretationError(
        "timeout",
        "Drawing interpretation timed out."
      );
    }
    throw new BoardInterpretationError(
      "api",
      error instanceof Error ? error.message : "Could not reach the model."
    );
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0.5;
  }
  const normalized = value > 1 && value <= 100 ? value / 100 : value;
  return Math.min(1, Math.max(0, normalized));
}

function cleanPhrase(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phrase = value
    .replace(/\s+/g, " ")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
  if (!phrase || phrase.length > 80 || /[\r\n]/.test(phrase)) {
    return null;
  }
  return phrase;
}

/**
 * Parse and validate the model's JSON. Exported for local testing.
 */
export function parseBoardInterpretation(raw: string): BoardInterpretationResult {
  let jsonText = raw.trim();

  const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    jsonText = fenced[1].trim();
  }

  const firstBrace = jsonText.indexOf("{");
  const lastBrace = jsonText.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new BoardInterpretationError(
      "invalid_response",
      "The model did not return a JSON object."
    );
  }
  jsonText = jsonText.slice(firstBrace, lastBrace + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new BoardInterpretationError(
      "invalid_response",
      "The model returned invalid JSON."
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new BoardInterpretationError(
      "invalid_response",
      "The model returned an unexpected response."
    );
  }

  const payload = parsed as {
    interpretations?: unknown;
    uncertain?: unknown;
  };

  if (!Array.isArray(payload.interpretations)) {
    throw new BoardInterpretationError(
      "invalid_response",
      "The model response has no interpretations."
    );
  }

  const seen = new Set<string>();
  const interpretations: BoardInterpretation[] = [];

  for (const item of payload.interpretations) {
    if (!item || typeof item !== "object") continue;
    const record = item as {
      phrase?: unknown;
      concept?: unknown;
      confidence?: unknown;
    };
    const phrase = cleanPhrase(record.phrase);
    if (!phrase) continue;

    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const confidence = normalizeConfidence(record.confidence);
    if (confidence < MIN_CONFIDENCE) continue;

    interpretations.push({
      phrase,
      concept:
        typeof record.concept === "string" && record.concept.trim()
          ? record.concept.trim()
          : phrase,
      confidence,
    });
  }

  interpretations.sort((a, b) => b.confidence - a.confidence);
  const limited = interpretations.slice(0, MAX_INTERPRETATIONS);
  const maxConfidence = limited[0]?.confidence ?? 0;

  return {
    interpretations: limited,
    uncertain:
      payload.uncertain === true ||
      limited.length === 0 ||
      maxConfidence < UNCERTAIN_THRESHOLD,
  };
}

function buildUserContent(
  input: BoardInterpretationInput
): ChatContent[] {
  const content: ChatContent[] = [];
  const tileLabels = input.tileLabels?.filter(Boolean) ?? [];
  const photos = (input.photoDataUrls ?? []).slice(-MAX_PHOTOS);

  let text = "Interpret the attached board.";
  if (tileLabels.length > 0) {
    text += `\nChild's word tiles, in reading order: ${tileLabels.join(" → ")}.`;
  }
  if (input.drawingDataUrl) {
    text += "\nThe attached image is the child's drawing (strokes only).";
  }
  if (photos.length > 0) {
    text += "\nPhoto(s) placed by the child are attached for context.";
  }
  text += "\nReturn only the JSON object.";

  content.push({ type: "text", text });

  if (input.drawingDataUrl) {
    content.push({
      type: "image_url",
      image_url: { url: input.drawingDataUrl },
    });
  }
  for (const photo of photos) {
    content.push({
      type: "image_url",
      image_url: { url: photo },
    });
  }

  return content;
}

async function requestInterpretation(
  input: BoardInterpretationInput
): Promise<BoardInterpretationResult> {
  if (!API_KEYS.OPENROUTER || API_KEYS.OPENROUTER.length < 20) {
    throw new BoardInterpretationError(
      "missing_key",
      "OpenRouter API key is missing. Set EXPO_PUBLIC_OPENROUTER_API_KEY."
    );
  }

  const messages: ChatMessage[] = [
    { role: "system", content: BOARD_INTERPRETATION_SYSTEM_PROMPT },
    { role: "user", content: buildUserContent(input) },
  ];

  const body = JSON.stringify({
    model: BOARD_INTERPRETATION_MODEL,
    messages,
    max_tokens: 350,
    temperature: 0.1,
    response_format: { type: "json_object" },
  });

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEYS.OPENROUTER}`,
    "HTTP-Referer": "https://aac-app.local",
    "X-Title": "AAC Communication App",
  };

  let response = await fetchWithTimeout(body, headers);

  // One bounded retry for rate limits. Do not retry other failures: a second
  // vision request costs money and usually returns the same error.
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader
      ? Number.parseInt(retryAfterHeader, 10)
      : NaN;
    const waitMs = Number.isFinite(retryAfterSeconds)
      ? Math.min(Math.max(retryAfterSeconds * 1000, 500), 2_000)
      : 1_000;
    await delay(waitMs);
    response = await fetchWithTimeout(body, headers);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    if (response.status === 429) {
      throw new BoardInterpretationError(
        "rate_limited",
        "The interpretation service is busy. Please try again."
      );
    }
    throw new BoardInterpretationError(
      "api",
      `Interpretation failed (${response.status})${
        errorText ? `: ${errorText.slice(0, 200)}` : ""
      }`
    );
  }

  let data: {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  try {
    data = await response.json();
  } catch {
    throw new BoardInterpretationError(
      "invalid_response",
      "The interpretation service returned an unreadable response."
    );
  }

  const raw = data.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new BoardInterpretationError(
      "invalid_response",
      "The model returned an empty interpretation."
    );
  }

  return parseBoardInterpretation(raw);
}

/**
 * Interpret a board drawing. Results are cached by board fingerprint, and
 * concurrent requests for the same board share one in-flight promise.
 */
export async function interpretBoard(
  input: BoardInterpretationInput
): Promise<BoardInterpretationResult> {
  const key = `${BOARD_INTERPRETATION_MODEL}:${input.fingerprint}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const request = requestInterpretation(input)
    .then((result) => {
      // A retry should be able to ask again when the model was unsure.
      if (!result.uncertain && result.interpretations.length > 0) {
        remember(key, result);
      }
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}
