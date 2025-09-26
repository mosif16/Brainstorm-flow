import { Type, type Schema, type GenerationConfig } from '@google/genai';
import type { AppConfig } from '../utils/env';
import { getGenAiClient } from './genAiClient';
import { mapUsage, readResponseText } from './gemini';
import type { GeminiUsage } from '../pipeline/types';

export type SeedTemplateKey =
  | 'product-launch'
  | 'retention-push'
  | 'workflow-automation'
  | 'market-expansion'
  | 'loyalty-refresh'
  | 'support-copilot'
  | 'insights-benchmark';

interface SeedTemplateDefinition {
  key: SeedTemplateKey;
  label: string;
  tagline: string;
  scenario: string;
  focus: string;
  angle: string;
}

interface SeedTemplateSummary {
  key: SeedTemplateKey;
  label: string;
  tagline: string;
  scenario: string;
  focus: string;
  angle: string;
}

interface SeedTemplateResult {
  goal: string;
  audience: string;
  constraints: string;
  usage: GeminiUsage;
  raw: string;
}

const SEED_TEMPLATES: Record<SeedTemplateKey, SeedTemplateDefinition> = {
  'product-launch': {
    key: 'product-launch',
    label: 'Product Launch Kickoff',
    tagline: 'Start with a launch target simple enough to riff on fast.',
    scenario:
      'A cross-functional squad is preparing to ship something new and needs a lightweight framing that inspires quick idea riffs.',
    focus:
      'State the core outcome in plain language, sketch the primary audience with one memorable trait, and list only the constraints that truly shape first-wave ideas (timeline, channels, approvals).',
    angle: 'Provide just enough direction for rapid expansion without overwhelming the first brainstorming pass.',
  },
  'retention-push': {
    key: 'retention-push',
    label: 'Retention Boost Sprint',
    tagline: 'Kick off simple moves that keep wavering users around.',
    scenario:
      'Growth or lifecycle teams need a quick starting point for retention experiments aimed at a clear-at-risk segment.',
    focus:
      'Highlight one metric to improve, describe the segment in a single vivid line, and surface the must-follow rules (like incentive limits or tone).',
    angle: 'Keep the brief lightweight so new engagement ideas can stack onto it quickly.',
  },
  'workflow-automation': {
    key: 'workflow-automation',
    label: 'Workflow Automation Upgrade',
    tagline: 'Frame a bite-sized automation win the team can build out.',
    scenario:
      'Operations or service partners want a clear workflow pain point that invites incremental automation ideas.',
    focus:
      'Name the clunky moment, call out who feels the friction, and mention only the guardrails that could block quick prototypes (systems, compliance, approvals).',
    angle: 'Aim for a modest improvement that unlocks deeper automation follow-ups.',
  },
  'market-expansion': {
    key: 'market-expansion',
    label: 'New Market Expansion',
    tagline: 'Outline a starter move into a fresh segment we can layer on.',
    scenario:
      'Product and strategy leads are testing the waters in a new region or niche and need a simple anchor before deep planning.',
    focus:
      'State the expansion goal in one plain sentence, describe the new audience with a standout behaviour, and mention the top boundary (like localization or partner needs).',
    angle: 'Seed a lightweight entry point that future research and go-to-market planning can amplify.',
  },
  'loyalty-refresh': {
    key: 'loyalty-refresh',
    label: 'Loyalty Program Refresh',
    tagline: 'Highlight a simple member win we can iterate from.',
    scenario:
      'Marketing and product teammates need a crisp prompt to rethink how the loyalty program keeps members coming back.',
    focus:
      'Clarify the one KPI to nudge, capture who the member is in everyday language, and note the boundaries (budget tiers, partner promises, tone).',
    angle: 'Keep it practical so the next session can pile on creative perks and journeys.',
  },
  'support-copilot': {
    key: 'support-copilot',
    label: 'Support Copilot Enablement',
    tagline: 'Start with a focused copilot assist we can layer intelligence onto.',
    scenario:
      'Support leaders want a clear use case where an AI copilot gives agents a nudge without overhauling everything.',
    focus:
      'Mention the service outcome in simple terms, describe the agent moment where help is needed, and point out must-follow rules (privacy, tools, trust).',
    angle: 'Seed a small assist that future automation and safeguards can extend.',
  },
  'insights-benchmark': {
    key: 'insights-benchmark',
    label: 'Insights & Benchmark Hub',
    tagline: 'Pin down a simple dashboard idea the team can scale up.',
    scenario:
      'Data and product partners need a quick prompt for an insights hub that highlights one comparison everyone cares about.',
    focus:
      'Share the decision question in plain words, note who needs the insight, and list the data or governance rule that could complicate things.',
    angle: 'Offer a starter take the analytics team can expand into richer benchmarks.',
  },
};

const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ['goal', 'audience', 'constraints'],
  properties: {
    goal: { type: Type.STRING },
    audience: { type: Type.STRING },
    constraints: { type: Type.STRING },
  },
};

export function listSeedTemplates(): SeedTemplateSummary[] {
  return Object.values(SEED_TEMPLATES).map((template) => ({
    key: template.key,
    label: template.label,
    tagline: template.tagline,
    scenario: template.scenario,
    focus: template.focus,
    angle: template.angle,
  }));
}

export function isSeedTemplateKey(value: string): value is SeedTemplateKey {
  return Object.prototype.hasOwnProperty.call(SEED_TEMPLATES, value);
}

function buildPrompt(definition: SeedTemplateDefinition): string {
  const lines = [
    'You are an expert product strategist helping a team kick off a brainstorming session.',
    'Generate a JSON object with keys: goal, audience, constraints.',
    'Each field should be 1-2 sentences, direct, and actionable. Keep each under 60 words.',
    '',
    `Template: ${definition.label}.`,
    `Scenario: ${definition.scenario}`,
    `Focus Guidance: ${definition.focus}`,
    `Strategic Angle: ${definition.angle}`,
    '',
    'Goal should state the core business or product outcome and what success looks like, including a measurable target or timeframe when possible.',
    'Audience should describe the target users or stakeholders with segmentation cues, observed behaviours, and key needs.',
    'Constraints should list the key boundaries, hard requirements, or limitations the team must respect, such as compliance, budget, integrations, or brand rules.',
    '',
    'Only output valid JSON that conforms exactly to the specified keys.',
  ];
  return lines.join('\n');
}

function parseSeedTemplate(raw: string): { goal: string; audience: string; constraints: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error('Gemini seed template response was not valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gemini seed template JSON must be an object.');
  }

  const result = parsed as Record<string, unknown>;
  const goal = typeof result.goal === 'string' ? result.goal.trim() : '';
  const audience = typeof result.audience === 'string' ? result.audience.trim() : '';
  const constraints = typeof result.constraints === 'string' ? result.constraints.trim() : '';

  if (!goal || !audience || !constraints) {
    throw new Error('Gemini seed template JSON missing required fields.');
  }

  return { goal, audience, constraints };
}

export async function generateSeedTemplate(
  config: AppConfig,
  key: SeedTemplateKey,
): Promise<SeedTemplateResult> {
  const template = SEED_TEMPLATES[key];
  if (!template) {
    throw new Error('Unknown seed template selected.');
  }

  const client = getGenAiClient(config);
  const prompt = buildPrompt(template);
  const generationConfig: GenerationConfig = {
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
  };

  const response = await client.models.generateContent({
    model: config.geminiModel,
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    config: generationConfig,
  });

  const raw = readResponseText(response);
  if (!raw || !raw.trim()) {
    throw new Error('Gemini seed template response missing text content.');
  }

  const values = parseSeedTemplate(raw);
  const usage = mapUsage(response.usageMetadata);

  return { ...values, usage, raw };
}

export type { SeedTemplateSummary, SeedTemplateResult };
