import { type GenerationConfig, type Schema, Type, type GenerateContentResponseUsageMetadata } from '@google/genai';
import { SeedInput, Idea, GeminiUsage } from '../pipeline/types';
import type { AppConfig } from '../utils/env';
import { getGenAiClient } from './genAiClient';

const ideaItemSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    rationale: { type: Type.STRING },
    risk: { type: Type.STRING, nullable: true },
  },
  required: ['title', 'description', 'rationale'],
  propertyOrdering: ['title', 'description', 'rationale', 'risk'],
};

const ideasResponseSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    ideas: {
      type: Type.ARRAY,
      items: ideaItemSchema,
    },
  },
  required: ['ideas'],
  propertyOrdering: ['ideas'],
};

function buildPrompt(seed: SeedInput, n: number, attempt: number): string {
  const attemptNote = attempt > 1 ? '\nReturn valid JSON only with the specified schema.' : '';
  return [
    'You are an expert creative strategist helping brainstorm product and campaign concepts.',
    `Generate ${n} diverse, high-quality ideas responding to the seed data.`,
    'Follow the structured response schema provided.',
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

export function mapUsage(metadata?: GenerateContentResponseUsageMetadata | null): GeminiUsage {
  const usage: GeminiUsage = {};
  if (!metadata) return usage;
  if (metadata.promptTokenCount !== undefined) {
    usage.promptTokenCount = metadata.promptTokenCount;
  }
  if (metadata.candidatesTokenCount !== undefined) {
    usage.candidatesTokenCount = metadata.candidatesTokenCount;
  }
  if (metadata.totalTokenCount !== undefined) {
    usage.totalTokenCount = metadata.totalTokenCount;
  }
  if (metadata.thoughtsTokenCount !== undefined) {
    usage.thoughtsTokenCount = metadata.thoughtsTokenCount;
  }
  if (metadata.toolUsePromptTokenCount !== undefined) {
    usage.toolUsePromptTokenCount = metadata.toolUsePromptTokenCount;
  }
  if (metadata.cachedContentTokenCount !== undefined) {
    usage.cachedContentTokenCount = metadata.cachedContentTokenCount;
  }
  return usage;
}

export function readResponseText(
  response: { text?: unknown },
): string {
  const candidate = response.text;
  if (typeof candidate === 'function') {
    const result = candidate.call(response);
    return typeof result === 'string' ? result : '';
  }
  return typeof candidate === 'string' ? candidate : '';
}

export async function generateIdeas(
  config: AppConfig,
  seed: SeedInput,
  n: number,
): Promise<{ ideas: Idea[]; usage: GeminiUsage; raw: string }> {
  const client = getGenAiClient(config);
  const attempts = [
    { useSchema: true },
    { useSchema: false },
  ] as const;
  let lastError: Error | null = null;

  for (const [idx, attempt] of attempts.entries()) {
    const { useSchema } = attempt;
    const attemptNumber = idx + 1;
    try {
      const prompt = buildPrompt(seed, n, attemptNumber);
      const configOverrides: GenerationConfig = {
        responseMimeType: 'application/json',
        ...(useSchema ? { responseSchema: ideasResponseSchema } : {}),
      };
      const response = await client.models.generateContent({
        model: config.geminiModel,
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        config: configOverrides,
      });
      const raw = readResponseText(response);
      if (!raw || raw.trim().length === 0) {
        throw new Error('Gemini response missing text content.');
      }
      const ideas = parseIdeas(raw);
      const usage = mapUsage(response.usageMetadata);
      return { ideas, usage, raw };
    } catch (err) {
      lastError = err as Error;
    }
  }

  throw lastError || new Error('Gemini generation failed.');
}
