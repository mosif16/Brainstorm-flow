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
    tagline: 'Frame a net-new product initiative with crisp launch goals.',
    scenario:
      'A cross-functional squad is gearing up to launch a flagship product or capability and needs unified problem framing.',
    focus:
      'Spell out the business objective, success metric, and launch window; profile the target segment with behavioural cues; and list hard constraints like channels, compliance stipulations, or governance gates.',
    angle: 'Inspire bold concepts while keeping the team anchored to a measurable launch outcome and explicit go-to-market boundaries.',
  },
  'retention-push': {
    key: 'retention-push',
    label: 'Retention Boost Sprint',
    tagline: 'Set the stage for experiments that reduce churn and increase engagement.',
    scenario:
      'Growth, lifecycle, or CRM partners want rapid-fire ideas to keep an at-risk cohort engaged across touchpoints.',
    focus:
      'Name the retention or engagement KPI, characterize the vulnerable cohort with triggers and pain points, and list incentives, tone, and regulatory guardrails the team must respect.',
    angle: 'Encourage experimentation while protecting brand voice and incentive policies.',
  },
  'workflow-automation': {
    key: 'workflow-automation',
    label: 'Workflow Automation Upgrade',
    tagline: 'Prime the team to streamline an internal or customer workflow.',
    scenario:
      'Ops or service teams need automation concepts to make a multi-step workflow faster, less error-prone, and more delightful for operators.',
    focus:
      'Describe the current-state workflow and bottlenecks, outline the primary operators and stakeholders, and capture constraints like integrations, compliance, or change-management adoption risks.',
    angle: 'Balance efficiency wins with human adoption and risk controls.',
  },
  'market-expansion': {
    key: 'market-expansion',
    label: 'New Market Expansion',
    tagline: 'Craft a seed that stretches the product into a fresh geography or customer segment.',
    scenario:
      'Strategy and product leadership are exploring expansion into a new region or vertical and need to surface localization, GTM, and operations considerations.',
    focus:
      'Articulate the expansion objective with target benchmarks, describe the new segment’s behaviours and unmet needs, and outline constraints around localization, compliance, partnerships, or supply chain.',
    angle: 'Help the team blend ambition with the practicalities of entering a new market responsibly.',
  },
  'loyalty-refresh': {
    key: 'loyalty-refresh',
    label: 'Loyalty Program Refresh',
    tagline: 'Reboot an aging rewards or membership program with sharper value props.',
    scenario:
      'Marketing and product teams want concepts that modernize an existing loyalty program to increase lifetime value and brand affinity.',
    focus:
      'State the loyalty KPIs to move, detail the member archetypes and their motivations, and list constraints like budget tiers, partnership obligations, or brand tone.',
    angle: 'Push for differentiated value while protecting economics and partner commitments.',
  },
  'support-copilot': {
    key: 'support-copilot',
    label: 'Support Copilot Enablement',
    tagline: 'Jump-start ideation on AI-assisted customer support workflows.',
    scenario:
      'Customer support leaders are evaluating AI copilots to reduce handle time and improve agent confidence.',
    focus:
      'Quantify the service goals, describe primary agent personas and escalation paths, and capture constraints such as privacy policies, tooling integrations, and trust requirements.',
    angle: 'Encourage agent-centric outcomes that build trust and maintain compliance.',
  },
  'insights-benchmark': {
    key: 'insights-benchmark',
    label: 'Insights & Benchmark Hub',
    tagline: 'Jump-start analytics and benchmarking initiatives for stakeholders.',
    scenario:
      'Data, product, and exec partners need ideas for a consolidated insights hub that compares performance across cohorts or competitors.',
    focus:
      'Define the decision-making goal, describe the stakeholder groups and their analytic maturity, and spell out data availability, governance rules, or visualization constraints.',
    angle: 'Drive clarity around decision readiness while respecting data stewardship obligations.',
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
