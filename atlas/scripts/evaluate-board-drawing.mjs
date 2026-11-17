#!/usr/bin/env bun
/**
 * Compare drawing interpretation strategies on the fixture set.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... bun scripts/evaluate-board-drawing.mjs
 *   OPENROUTER_API_KEY=... MODEL=google/gemini-2.5-flash-lite bun scripts/evaluate-board-drawing.mjs
 *
 * This prints per-drawing outputs, not a published accuracy claim. Review the
 * phrases manually; the automatic checks are only a rough sanity signal.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("Set OPENROUTER_API_KEY to run the evaluation.");
  process.exit(1);
}

process.env.EXPO_PUBLIC_OPENROUTER_API_KEY = apiKey;
process.env.EXPO_PUBLIC_BOARD_INTERPRETATION_MODEL =
  process.env.MODEL || "google/gemini-3.1-flash-lite";

const { parseBoardInterpretation, BOARD_INTERPRETATION_SYSTEM_PROMPT } =
  await import("../services/boardInterpretation.ts");

const VLM_MODEL = process.env.MODEL || "google/gemini-3.1-flash-lite";
const JEV_MODEL = process.env.JEV_MODEL || "typesafe/jev-1.14";
const ROOT = new URL("../eval/board-drawings/", import.meta.url);
const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

const OBJECT_CRITERIA = {
  water: "A glass, cup, or other container of water.",
  sun: "A sun with rays.",
  house: "A house or home.",
  food: "Food, such as an apple or a meal.",
  person: "A person or stick figure.",
  ambiguous: "An unclear or incomplete drawing that does not clearly show one object.",
};

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${apiKey}`,
  "HTTP-Referer": "https://aac-app.local",
  "X-Title": "AAC Board Evaluation",
};

function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/[.,!?;:'"“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function postJson(url, body) {
  const started = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const latencyMs = Math.round(performance.now() - started);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status}: ${text.slice(0, 300)}`);
  }

  return { data: JSON.parse(text), latencyMs };
}

async function runVlm(dataUrl) {
  const { data, latencyMs } = await postJson(CHAT_URL, {
    model: VLM_MODEL,
    messages: [
      { role: "system", content: BOARD_INTERPRETATION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Interpret the attached drawing. Return only the JSON object.",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: 350,
    temperature: 0.2,
    response_format: { type: "json_object" },
  });

  const raw = data.choices?.[0]?.message?.content;
  return {
    result: parseBoardInterpretation(raw),
    latencyMs,
    cost: data.usage?.cost ?? null,
  };
}

async function runJev(dataUrl, phrases) {
  const questions = {
    object: {
      type: "choice",
      instructions: "What is the main object in the drawing?",
      criteria: OBJECT_CRITERIA,
    },
  };

  if (phrases.length > 0) {
    questions.best_phrase = {
      type: "choice",
      instructions:
        "Which phrase best matches what the child is trying to communicate?",
      criteria: Object.fromEntries(
        phrases.map((phrase, index) => [`p${index}`, phrase])
      ),
    };
  }

  const { data, latencyMs } = await postJson(DECISIONS_URL, {
    model: JEV_MODEL,
    state: [
      { type: "image_url", image_url: { url: dataUrl } },
      "A child's drawing on a white board.",
    ],
    questions,
  });

  const object = data.answers?.object?.choice ?? null;
  const phraseKey = data.answers?.best_phrase?.choice ?? null;
  const phraseIndex = phraseKey ? Number.parseInt(phraseKey.slice(1), 10) : -1;

  return {
    object,
    phrase: phraseIndex >= 0 ? phrases[phraseIndex] : null,
    latencyMs,
    cost: data.usage?.cost ?? null,
  };
}

const manifest = JSON.parse(
  await readFile(new URL("manifest.json", ROOT), "utf8")
);

const rows = [];
for (const item of manifest) {
  const bytes = await readFile(new URL(item.file, ROOT));
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;

  let vlm;
  try {
    vlm = await runVlm(dataUrl);
  } catch (error) {
    rows.push({
      file: item.file,
      expected: item.expectedObject,
      error: `VLM: ${error.message}`,
    });
    continue;
  }

  const phrases = vlm.result.interpretations.map((entry) => entry.phrase);
  const vlmMatch =
    item.expectedObject === "ambiguous"
      ? vlm.result.uncertain
      : phrases.some((phrase) =>
          item.acceptablePhrases.some(
            (acceptable) => normalize(phrase) === normalize(acceptable)
          )
        );

  let jevDirect;
  let jevRerank;
  try {
    jevDirect = await runJev(dataUrl, []);
    await Bun.sleep(250);
    jevRerank = await runJev(dataUrl, phrases);
  } catch (error) {
    rows.push({
      file: item.file,
      expected: item.expectedObject,
      vlmPhrases: phrases.join(" | "),
      vlmMatch,
      error: `Jev: ${error.message}`,
    });
    continue;
  }

  const rerankMatch =
    item.expectedObject === "ambiguous"
      ? vlm.result.uncertain
      : item.acceptablePhrases.some(
          (acceptable) => normalize(jevRerank.phrase ?? "") === normalize(acceptable)
        );

  rows.push({
    file: item.file,
    expected: item.expectedObject,
    vlmPhrases: phrases.join(" | "),
    vlmUncertain: vlm.result.uncertain,
    vlmMatch,
    vlmMs: vlm.latencyMs,
    vlmCost: vlm.cost,
    jevObject: jevDirect.object,
    jevObjectMatch: jevDirect.object === item.expectedObject,
    jevMs: jevDirect.latencyMs,
    jevCost: jevDirect.cost,
    jevReranked: jevRerank.phrase,
    jevRerankMatch: rerankMatch,
  });

  await Bun.sleep(250);
}

console.table(rows);
