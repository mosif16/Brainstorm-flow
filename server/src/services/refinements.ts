import { Type, type Schema, type GenerationConfig } from '@google/genai';
import type { AppConfig } from '../utils/env';
import { getGenAiClient } from './genAiClient';
import { mapUsage, readResponseText } from './gemini';
import type { GeminiUsage } from '../pipeline/types';

export type RefinementKind = 'ui-flow' | 'capability-breakdown' | 'experience-polish';

type RefinementTemplate = {
  label: string;
  description: string;
  fields: Array<{ key: string; label: string; placeholder: string }>;
};

type RefinementTemplates = Record<RefinementKind, RefinementTemplate>;

const TEMPLATES: RefinementTemplates = {
  'ui-flow': {
    label: 'UI Flow Sketch',
    description:
      'Outline the user journey for this concept so design can translate it into flow diagrams or wireframes.',
    fields: [
      { key: 'entryPoints', label: 'Entry points', placeholder: 'Where does the user encounter this idea first?' },
      {
        key: 'primaryInteractions',
        label: 'Primary interactions',
        placeholder: 'List the key screens, steps, or components the user navigates through.',
      },
      { key: 'edgeCases', label: 'Edge cases', placeholder: 'Capture failure states or alternate flows to watch.' },
      {
        key: 'successCriteria',
        label: 'Success criteria',
        placeholder: 'Define what a successful experience looks like for users and the business.',
      },
    ],
  },
  'capability-breakdown': {
    label: 'Capability Breakdown',
    description: 'Identify the technical, operational, and data capabilities needed to bring this idea to life.',
    fields: [
      { key: 'apis', label: 'APIs & services', placeholder: 'List new or existing APIs / services required.' },
      { key: 'dataModels', label: 'Data models', placeholder: 'Which data structures or storage updates are needed?' },
      { key: 'integrations', label: 'Integrations', placeholder: 'Call out internal or third-party integrations.' },
      {
        key: 'dependencies',
        label: 'Dependencies & sequencing',
        placeholder: 'Note cross-team dependencies, sequencing, or blockers.',
      },
    ],
  },
  'experience-polish': {
    label: 'Experience Polish Checklist',
    description: 'Track the experience-level considerations that ensure the idea ships with the right level of quality.',
    fields: [
      {
        key: 'accessibility',
        label: 'Accessibility',
        placeholder: 'Contrast, keyboard paths, semantics, assistive tech behaviours…',
      },
      {
        key: 'performance',
        label: 'Performance',
        placeholder: 'Targets, instrumentation, perceived-performance tactics, budgets.',
      },
      { key: 'localization', label: 'Localization & voice', placeholder: 'Language, tone, regional content, formatting.' },
      {
        key: 'analytics',
        label: 'Analytics & learning',
        placeholder: 'Event naming, dashboards, cohorts, feedback loops.',
      },
    ],
  },
};

type TemplateKey = keyof typeof TEMPLATES;

const schemaByTemplate: Record<TemplateKey, Schema> = {
  'ui-flow': {
    type: Type.OBJECT,
    properties: Object.fromEntries(
      TEMPLATES['ui-flow'].fields.map((field) => [field.key, { type: Type.STRING }]),
    ),
    required: TEMPLATES['ui-flow'].fields.map((field) => field.key),
  },
  'capability-breakdown': {
    type: Type.OBJECT,
    properties: Object.fromEntries(
      TEMPLATES['capability-breakdown'].fields.map((field) => [field.key, { type: Type.STRING }]),
    ),
    required: TEMPLATES['capability-breakdown'].fields.map((field) => field.key),
  },
  'experience-polish': {
    type: Type.OBJECT,
    properties: Object.fromEntries(
      TEMPLATES['experience-polish'].fields.map((field) => [field.key, { type: Type.STRING }]),
    ),
    required: TEMPLATES['experience-polish'].fields.map((field) => field.key),
  },
};

export interface RefinementIdeaPayload {
  title: string;
  description?: string;
  rationale?: string;
  risk?: string;
}

export interface RefinementContextPayload {
  goal?: string;
  audience?: string;
  constraints?: string;
}

export interface GenerateRefinementParams {
  kind: RefinementKind;
  idea: RefinementIdeaPayload;
  context?: RefinementContextPayload;
}

export interface GenerateRefinementResult {
  fields: Record<string, string>;
  usage: GeminiUsage;
  raw: string;
}

function buildPrompt(kind: RefinementKind, idea: RefinementIdeaPayload, context?: RefinementContextPayload): string {
  const template = TEMPLATES[kind];
  const sections = [
    'You are a senior product strategist and UX collaborator shaping a shippable app experience.',
    `Generate a structured ${template.label.toLowerCase()} for the following concept.`,
    'Respond with JSON only that matches the provided schema.',
    'Assume the product is launching for users in the United States unless the concept or context states otherwise, and weave in any US-specific considerations.',
    '',
    'Concept Details:',
    `- Title: ${idea.title}`,
  ];

  if (idea.description) sections.push(`- Description: ${idea.description}`);
  if (idea.rationale) sections.push(`- Rationale: ${idea.rationale}`);
  if (idea.risk) sections.push(`- Risk: ${idea.risk}`);

  if (context) {
    const { goal, audience, constraints } = context;
    if (goal || audience || constraints) {
      sections.push('', 'Seed Context:');
      if (goal) sections.push(`- Goal: ${goal}`);
      if (audience) sections.push(`- Audience: ${audience}`);
      if (constraints) sections.push(`- Constraints: ${constraints}`);
    }
  }

  sections.push('', 'Output Requirements:', 'Anchor every field in the realities of shipping and scaling this app for US users, while calling out creative flourishes or standout mechanics that reinforce differentiation.');
  template.fields.forEach((field, index) => {
    sections.push(`${index + 1}. ${field.label}: ${field.placeholder}`);
  });
  sections.push('', 'Only output valid JSON.');

  return sections.join('\n');
}

function parseRefinement(kind: RefinementKind, raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error('Gemini refinement response was not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gemini refinement JSON must be an object.');
  }

  const template = TEMPLATES[kind];
  const output: Record<string, string> = {};
  for (const field of template.fields) {
    const value = (parsed as Record<string, unknown>)[field.key];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Refinement field "${field.key}" missing or empty.`);
    }
    output[field.key] = value.trim();
  }
  return output;
}

export async function generateRefinement(
  config: AppConfig,
  params: GenerateRefinementParams,
): Promise<GenerateRefinementResult> {
  const { kind, idea, context } = params;
  if (!TEMPLATES[kind]) {
    throw new Error(`Unsupported refinement kind: ${kind}`);
  }
  if (!idea?.title) {
    throw new Error('Idea title is required for refinement generation.');
  }

  const client = getGenAiClient(config);
  const prompt = buildPrompt(kind, idea, context);
  const schema = schemaByTemplate[kind];

  const configOverrides: GenerationConfig = {
    responseMimeType: 'application/json',
    responseSchema: schema,
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
    throw new Error('Gemini refinement response missing text content.');
  }

  const fields = parseRefinement(kind, raw);
  const usage = mapUsage(response.usageMetadata);

  return { fields, usage, raw };
}
