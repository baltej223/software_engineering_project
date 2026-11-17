import { API_ENDPOINTS, API_KEYS } from "@/config/api";
import { Tile } from "@/constants/tiles";

type TextContent = {
  type: "text";
  text: string;
};

type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
  };
};

type Message = {
  role: "system" | "user" | "assistant";
  content: string | (TextContent | ImageContent)[];
};

async function chat(
  messages: Message[],
  model = "dots-studio/dots-3-note-preview:free"
): Promise<string> {
  if (!API_KEYS.OPENROUTER || API_KEYS.OPENROUTER.length < 20) {
    console.error(
      "[OpenRouter] API key not set or invalid. Check .env.local file."
    );
    throw new Error(
      "OpenRouter API key is missing or invalid. Please set EXPO_PUBLIC_OPENROUTER_API_KEY in .env.local"
    );
  }

  const response = await fetch(`${API_ENDPOINTS.OPENROUTER}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEYS.OPENROUTER}`,
      "HTTP-Referer": "https://aac-app.local",
      "X-Title": "AAC Communication App",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 256,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("[OpenRouter] API Error:", response.status, error);
    if (response.status === 401) {
      throw new Error(
        "OpenRouter API key is invalid or expired. Please get a new key from https://openrouter.ai/keys and update EXPO_PUBLIC_OPENROUTER_API_KEY in .env.local"
      );
    }
    throw new Error(`OpenRouter error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export async function suggestNextWords(
  sentence: Tile[],
  availableTiles: Tile[]
): Promise<string[]> {
  const sentenceText = sentence.map((t) => t.label).join(" ");
  const tileLabels = availableTiles
    .filter((t) => !t.isFolder)
    .map((t) => t.label);

  const systemPrompt = `You are an AAC (Augmentative and Alternative Communication) assistant helping users build sentences.
Given the current sentence and available word tiles, suggest the 5 most likely next words the user might want to add.
Only suggest words from the available tiles list. Return just the words separated by commas, nothing else.`;

  const userPrompt = `Current sentence: "${sentenceText || "(empty)"}"
Available tiles: ${tileLabels.join(", ")}

Suggest 5 next words:`;

  try {
    const result = await chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    const suggestions = result
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => tileLabels.some((t) => t.toLowerCase() === s))
      .slice(0, 5);

    return suggestions;
  } catch (error) {
    console.error("AI suggestion failed:", error);
    return [];
  }
}

export async function interpretBoard(
  tileLabels: string[],
  boardDescription?: string,
  drawingImageBase64?: string,
  placedPhotoUris?: string[]
): Promise<string[]> {
  const systemPrompt = `You are an AAC message renderer. The child has already communicated with the words, drawings, and photos on the board. Return the child's message for the speech button to say.

Rules:
- Output only the message itself. Never explain, summarize, narrate, or say what "the child" wants.
- Treat the written tile sequence in the user message as authoritative. Preserve its words and order; do not translate, paraphrase, correct, or replace it with a more natural English sentence.
- Use a drawing or photo only to resolve what a visible symbol refers to. Do not add words or ideas that the board does not support.
- If the board has only word tiles and no drawing or photo, repeat the tile sequence exactly as a single phrase.
- If there is a drawing or photo, return at most three short message options, one per line. Each option must still be a message the child could say, never an explanation.
- No headings, quotation marks, bullets, numbering, or extra commentary.

Example: for "Word tiles (in reading order): I → want → hungry" with no drawing or photo, return exactly:
I want hungry`;

  // With tiles alone, return the child's exact sequence. This avoids asking a
  // language model to paraphrase an already complete AAC message.
  const tileSequence = boardDescription?.match(
    /Word tiles \(in reading order\):\s*([^\n.]+)/i
  )?.[1];
  const hasVisualContext =
    /Child's drawing present|photo\(s\) placed on board/i.test(boardDescription ?? '') ||
    (placedPhotoUris?.length ?? 0) > 0;

  if (tileSequence && !hasVisualContext) {
    return [tileSequence.split('→').map((word) => word.trim()).filter(Boolean).join(' ')];
  }

  // Build message content - IMPORTANT: Include the actual images for vision
  const messageContent: (TextContent | ImageContent)[] = [];

  // Add the drawing image FIRST so the AI can actually see it
  if (drawingImageBase64) {
    // The image should now be PNG base64 from the canvas conversion
    const imageUrl = drawingImageBase64.startsWith("data:")
      ? drawingImageBase64
      : `data:image/png;base64,${drawingImageBase64}`;

    messageContent.push({
      type: "image_url",
      image_url: {
        url: imageUrl,
      },
    });
  }

  // Add actual photo images so the AI can see what they depict
  if (placedPhotoUris && placedPhotoUris.length > 0) {
    for (const photoUri of placedPhotoUris) {
      messageContent.push({
        type: "image_url",
        image_url: {
          url: photoUri,
        },
      });
    }
  }

  let textPrompt =
    "Return only the message the child is communicating, ready for the speech button. Do not explain or paraphrase it.\n\n";

  if (boardDescription) {
    textPrompt += `Additional context:\n${boardDescription}\n\n`;
  } else if (tileLabels.length > 0) {
    textPrompt += `Word tiles visible: ${tileLabels.join(", ")}\n\n`;
  }

  textPrompt +=
    "Use the tile sequence as the child's chosen words and preserve it in order. Refer to drawings or photos only when they clarify the message. Output only the message, not an explanation.";

  messageContent.push({
    type: "text",
    text: textPrompt,
  });

  try {
    const result = await chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: messageContent },
    ]);

    return result
      .split("\n")
      .map((line) => line.replace(/^[\d\.\)\-\*\s]+/, "").trim())
      .filter((line) => line.length > 0)
      .slice(0, 3);
  } catch (error) {
    console.error("Board interpretation failed:", error);
    return tileSequence
      ? [tileSequence.split('→').map((word) => word.trim()).filter(Boolean).join(' ')]
      : [];
  }
}

export async function mapTranscriptToTiles(
  transcript: string,
  availableTileLabels: string[]
): Promise<string[]> {
  const systemPrompt = `You are an AAC assistant. Convert spoken text into AAC tile words.
Given a transcript and available tile labels, return the tile labels that best represent the message.
Only use words from the available tiles. Return just the words separated by commas.`;

  const userPrompt = `Transcript: "${transcript}"
Available tiles: ${availableTileLabels.join(", ")}

Convert to tiles:`;

  try {
    const result = await chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    return result
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => availableTileLabels.some((t) => t.toLowerCase() === s));
  } catch (error) {
    console.error("Transcript mapping failed:", error);
    return [];
  }
}

export async function detectEmotion(sentence: string): Promise<string> {
  const systemPrompt = `Analyze the emotional tone of this sentence for expressive text-to-speech.
Return exactly one word from this list: neutral, happy, sad, excited, angry, calm, curious, or thoughtful.
Consider:
- Excited: Questions, exclamations, enthusiasm
- Happy: Positive statements, compliments
- Curious: Questions, wanting to know
- Thoughtful: Reflective statements, 'I think...'
- Calm: Gentle statements, reassurance
- Sad: Negative emotions, loss
- Angry: Frustration, emphasis
- Neutral: Regular statements`;

  try {
    const result = await chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: sentence },
    ]);

    const emotion = result.trim().toLowerCase();
    const valid = [
      "neutral",
      "happy",
      "sad",
      "excited",
      "angry",
      "calm",
      "curious",
      "thoughtful",
    ];
    return valid.includes(emotion) ? emotion : "neutral";
  } catch {
    return "neutral";
  }
}

/**
 * Simplify a complex sentence into simple AAC-friendly words that can be represented by tiles.
 * Returns both the simplified sentence and the individual tile words.
 */
export async function simplifySentence(
  sentence: string,
  availableTileLabels: string[]
): Promise<{ simplified: string; tileWords: string[] }> {
  const systemPrompt = `You are an AAC (Augmentative and Alternative Communication) expert. Your job is to convert spoken sentences into a sequence of word tiles using fuzzy matching.

CRITICAL RULES:
1. You MUST ONLY return words that are in the available tiles list - NO OTHER WORDS
2. Include ALL key words from the sentence that have matching tiles available
3. For each word in the sentence:
   - First try exact match (case-insensitive)
   - If no exact match, try singular/plural variants (movies→movie, friends→friend)
   - If still no match, find the closest semantic match among available tiles
   - Skip only if no reasonable match exists
4. Do NOT limit the number of tiles - include every meaningful word that has a tile
5. Preserve the order of words as spoken
6. Return ONLY a JSON object with a tileWords array, nothing else

Example:
Available tiles: I, you, want, go, eat, drink, play, help, more, stop, yes, no, happy, sad, mom, dad, home, school, food, water, chicken, pizza, movie
Input: "I want to go to the movies and eat chicken and pizza"
Output: {"tileWords": ["I", "want", "go", "movie", "eat", "chicken", "pizza"]}

Example:
Available tiles: I, you, want, go, eat, drink, play, help, more, stop, yes, no, happy, sad, mom, dad, home, school, food, water, mall, friend
Input: "I want to go to the mall with my friends"
Output: {"tileWords": ["I", "want", "go", "mall", "friend"]}

Example:
Available tiles: I, you, want, go, eat, drink, play, help, more, stop, yes, no, happy, sad, mom, dad, home, school, food, water
Input: "Are you okay? You seem upset today."
Output: {"tileWords": ["you", "sad", "help"]}`;

  const userPrompt = `Available tiles: ${availableTileLabels.join(", ")}

Sentence: "${sentence}"

Convert to tiles (JSON only, include ALL matching tiles):`;

  try {
    const result = await chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    console.log("[OpenRouter] Simplify RAW result:", result);
    console.log(
      "[OpenRouter] Available tiles sample:",
      availableTileLabels.slice(0, 20)
    );

    // Try to parse JSON from the response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      console.log("[OpenRouter] Found JSON:", jsonMatch[0]);
      const parsed = JSON.parse(jsonMatch[0]);
      console.log("[OpenRouter] Parsed:", parsed);

      const tileWords = (parsed.tileWords || parsed.tiles || [])
        .map((w: string) => w.toLowerCase().trim())
        .filter((w: string) => {
          const found = availableTileLabels.some((t) => t.toLowerCase() === w);
          if (!found) {
            console.log(
              `[OpenRouter] Word "${w}" not found in available tiles`
            );
          }
          return found;
        });

      console.log("[OpenRouter] Filtered tile words:", tileWords);

      return {
        simplified: tileWords.join(" "),
        tileWords,
      };
    }

    // Fallback: try to extract words that match available tiles
    console.log("[OpenRouter] No JSON found, trying word extraction fallback");
    const words = result
      .replace(/[^\w\s,]/g, "")
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(
        (s) => s && availableTileLabels.some((t) => t.toLowerCase() === s)
      );

    console.log("[OpenRouter] Fallback extracted words:", words);

    return {
      simplified: words.join(" "),
      tileWords: words,
    };
  } catch (error) {
    console.error("[OpenRouter] Sentence simplification FAILED:", error);
    // Return empty tiles so UI shows "Processing..." instead of the original sentence
    return { simplified: "", tileWords: [] };
  }
}

/**
 * Generate a contextual reply suggestion based on the conversation
 */
export async function suggestReply(
  incomingSentence: string,
  availableTileLabels: string[]
): Promise<string[]> {
  const systemPrompt = `You are an AAC assistant helping someone respond to a conversation.
Given what someone said to the user, suggest 3 simple reply options using available AAC tiles.
Each reply should be 2-4 words maximum.
Return just the replies, one per line, using only words from the available tiles.`;

  const userPrompt = `Someone said: "${incomingSentence}"

Available tiles: ${availableTileLabels.join(", ")}

Suggest 3 simple replies (one per line):`;

  try {
    const result = await chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    return result
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 3);
  } catch (error) {
    console.error("Reply suggestion failed:", error);
    return ["yes", "no", "help"];
  }
}
