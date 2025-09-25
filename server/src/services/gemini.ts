import { SeedInput, Idea, GeminiUsage } from '../pipeline/types';
import type { AppConfig } from '../utils/env';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'models/gemini-1.5-pro-latest';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

type GeminiCandidate = {
  content?: {
    parts?: Array<{ text?: string }>;
  };
};

type GeminiGenerateResponse = {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

type GeminiError = {
  error: {
    message: string;
  };
};

async function callGemini(config: AppConfig, prompt: string): Promise<GeminiGenerateResponse> {
  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${config.geminiApiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as GeminiError | null;
    const message = errorBody?.error?.message || `Gemini API error: ${response.statusText}`;
    throw new Error(message);
  }

  const data = (await response.json()) as GeminiGenerateResponse;
  return data;
}

function buildPrompt(seed: SeedInput, n: number, attempt: number): string {
  const attemptNote = attempt > 1 ? '\nSTRICTLY return valid JSON ONLY. No prose.' : '';
  return [
    'You are an expert creative strategist helping brainstorm product and campaign concepts.',
    `Generate ${n} diverse ideas based on the seed data.`,
    'Return a JSON object with this exact shape:',
    '{"ideas": [{"title": string, "description": string, "rationale": string, "risk": string}] }',
    'Rules:',
    '- titles under 10 words',
    '- description 2-3 sentences',
    '- rationale 1 sentence',
    '- risk summarises a key execution risk in 1 sentence',
    `Goal: ${seed.goal}`,
    `Audience: ${seed.audience}`,
    `Constraints: ${seed.constraints}`,
    attemptNote,
  ].join('\n');
}

function extractIdeasText(response: GeminiGenerateResponse): string {
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini response missing text content.');
  }
  return text;
}

function parseIdeas(raw: string): Idea[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error('Gemini response was not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || !('ideas' in parsed)) {
    throw new Error('Gemini JSON missing "ideas" field.');
  }

  const ideas = (parsed as { ideas: unknown }).ideas;
  if (!Array.isArray(ideas) || ideas.length === 0) {
    throw new Error('Gemini JSON "ideas" must be a non-empty array.');
  }

  const cleaned = ideas.map((idea, idx) => {
    if (!idea || typeof idea !== 'object') {
      throw new Error(`Idea at index ${idx} is not an object.`);
    }
    const { title, description, rationale, risk } = idea as Record<string, unknown>;
    if (typeof title !== 'string' || typeof description !== 'string' || typeof rationale !== 'string') {
      throw new Error(`Idea at index ${idx} missing required fields.`);
    }
    const cleanedIdea: Idea = {
      title: title.trim(),
      description: description.trim(),
      rationale: rationale.trim(),
    };
    if (typeof risk === 'string') {
      const trimmedRisk = risk.trim();
      if (trimmedRisk.length > 0) {
        cleanedIdea.risk = trimmedRisk;
      }
    }
    return cleanedIdea;
  });

  return cleaned;
}

export async function generateIdeas(
  config: AppConfig,
  seed: SeedInput,
  n: number,
): Promise<{ ideas: Idea[]; usage: GeminiUsage; raw: string }> {
  const attempts = [1, 2];
  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      const prompt = buildPrompt(seed, n, attempt);
      const response = await callGemini(config, prompt);
      const raw = extractIdeasText(response);
      const ideas = parseIdeas(raw);
      const usage: GeminiUsage = {};
      if (response.usageMetadata?.promptTokenCount !== undefined) {
        usage.promptTokenCount = response.usageMetadata.promptTokenCount;
      }
      if (response.usageMetadata?.candidatesTokenCount !== undefined) {
        usage.candidatesTokenCount = response.usageMetadata.candidatesTokenCount;
      }
      if (response.usageMetadata?.totalTokenCount !== undefined) {
        usage.totalTokenCount = response.usageMetadata.totalTokenCount;
      }
      return { ideas, usage, raw };
    } catch (err) {
      lastError = err as Error;
    }
  }
  throw lastError || new Error('Gemini generation failed.');
}
