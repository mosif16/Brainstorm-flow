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
  | 'insights-benchmark'
  | 'health-habit'
  | 'wellness-program'
  | 'productivity-flow'
  | 'fitness-challenge'
  | 'mindful-reset'
  | 'nutrition-nudge'
  | 'meeting-makeover'
  | 'mobile-onboarding'
  | 'push-momentum'
  | 'ios-widget-drop'
  | 'app-store-spotlight';

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
    tagline: 'Frame an app launch target simple enough to prototype fast.',
    scenario:
      'A cross-functional app squad is preparing to ship a new digital experience and needs a lightweight framing that inspires concrete product concepts.',
    focus:
      'State the app outcome in plain language, sketch the primary user segment with one memorable trait, and list only the constraints that shape the first release (platform, channels, approvals).',
    angle: 'Provide just enough direction for ideating app features without overwhelming the first brainstorming pass.',
  },
  'retention-push': {
    key: 'retention-push',
    label: 'Retention Boost Sprint',
    tagline: 'Kick off app moves that keep wavering users around.',
    scenario:
      'Growth or lifecycle teams need a clear starting point for in-app retention experiments aimed at an at-risk segment.',
    focus:
      'Highlight the retention metric to improve, describe the segment with their in-app behaviour signal, and surface the rules that shape the product experience (incentives, tone, data use).',
    angle: 'Keep it lightweight so app engagement features can stack quickly.',
  },
  'workflow-automation': {
    key: 'workflow-automation',
    label: 'Workflow Automation Upgrade',
    tagline: 'Frame a bite-sized in-app automation win the team can ship.',
    scenario:
      'Operations or service partners want a clear workflow pain point that invites productized automation inside their platform.',
    focus:
      'Name the clunky moment, call out who feels the friction, and note only the guardrails that affect automating it in-app (systems, compliance, approvals).',
    angle: 'Aim for a modest improvement that unlocks deeper automation features.',
  },
  'market-expansion': {
    key: 'market-expansion',
    label: 'New Market Expansion',
    tagline: 'Outline the starter app move into a fresh segment.',
    scenario:
      'Product and strategy leads are entering a new region or niche and need an app concept anchor before deep planning.',
    focus:
      'State the expansion goal in one sentence, describe the new audience with their platform habits, and mention the top boundary (localization, partners, regulation).',
    angle: 'Seed an app entry point that research and go-to-market can amplify.',
  },
  'loyalty-refresh': {
    key: 'loyalty-refresh',
    label: 'Loyalty Program Refresh',
    tagline: 'Highlight a loyalty app win we can iterate from.',
    scenario:
      'Marketing and product teammates need a crisp prompt to rethink how the app keeps members coming back.',
    focus:
      'Clarify the KPI to nudge, capture the member persona with their digital behaviour, and note the boundaries that shape feature design (budget tiers, partner promises, tone).',
    angle: 'Keep it practical so new loyalty app journeys can layer on quickly.',
  },
  'support-copilot': {
    key: 'support-copilot',
    label: 'Support Copilot Enablement',
    tagline: 'Start with a focused in-app copilot assist we can scale.',
    scenario:
      'Support leaders want a clear app use case where an AI copilot nudges agents without overhauling workflows.',
    focus:
      'Mention the service outcome in simple terms, describe the agent moment in-product, and point out the rules for shipping the feature (privacy, tools, trust).',
    angle: 'Seed a small assist that future automation and safeguards can extend.',
  },
  'insights-benchmark': {
    key: 'insights-benchmark',
    label: 'Insights & Benchmark Hub',
    tagline: 'Pin down a dashboard app idea the team can scale.',
    scenario:
      'Data and product partners need a quick prompt for an insights hub that highlights one comparison everyone cares about inside the product.',
    focus:
      'Share the decision question, note the user role consuming it, and list the data or governance rule that shapes the app experience.',
    angle: 'Offer a starter app take the analytics team can expand into richer benchmarks.',
  },
  'health-habit': {
    key: 'health-habit',
    label: 'Health Habit Kickstart',
    tagline: 'Frame a personal wellness ritual that feels doable tomorrow.',
    scenario:
      'Consumer health or coaching teams need a crisp starting point that nudges people toward a single, sustainable habit change.',
    focus:
      'State the wellbeing outcome, describe the persona with the moment the app must intervene, and surface any medical, budget, or device guardrails for feature design.',
    angle: 'Keep the habit intentionally small so app reminders and coaching loops can layer in.',
  },
  'wellness-program': {
    key: 'wellness-program',
    label: 'Workplace Wellness Pulse',
    tagline: 'Spin up a wellness app activation employees will actually try.',
    scenario:
      'People teams want to re-energize wellness offerings with an inclusive, measurable digital experience they can launch quickly.',
    focus:
      'Name the employee outcome, sketch the cohort with their digital context, and note policy, vendor, or budget constraints that shape the app rollout.',
    angle: 'Design a pilot-friendly app pulse the team can expand once traction appears.',
  },
  'productivity-flow': {
    key: 'productivity-flow',
    label: 'Deep Work Rhythm Refresh',
    tagline: 'Cue up a sustainable productivity experiment that respects reality.',
    scenario:
      'Leaders or individual contributors need a pragmatic template to rethink focus time, collaboration rituals, and energy management.',
    focus:
      'Clarify the productivity goal, capture the team or persona with their biggest distraction inside current tools, and include the boundaries that shape the app experience (stacks, schedules, compliance).',
    angle: 'Seed a realistic app-driven reset that future automation or coaching can enrich.',
  },
  'fitness-challenge': {
    key: 'fitness-challenge',
    label: 'Micro Fitness Challenge',
    tagline: 'Kick off a two-week movement push that feels inclusive for everyone.',
    scenario:
      'Distributed teams want a simple physical activity prompt that builds camaraderie without requiring fancy gear or long commitments.',
    focus:
      'Define the health outcome, paint the participant with their blocker, and note equipment, accessibility, or policy limits so the challenge fits inside an app flow.',
    angle: 'Keep it playful and short so in-app adoption stays high and informs future wellness cycles.',
  },
  'mindful-reset': {
    key: 'mindful-reset',
    label: 'Mindful Reset Moment',
    tagline: 'Cue a lightweight mindfulness ritual teams can share asynchronously.',
    scenario:
      'Employee experience groups need a grounding practice that can be slotted between meetings without derailing schedules.',
    focus:
      'State the calm outcome, describe the peak-stress moment the app must intercept, and surface cultural, privacy, or tooling guardrails for the experience.',
    angle: 'Design a refillable in-app ritual future versions can deepen with audio, peer prompts, or analytics.',
  },
  'nutrition-nudge': {
    key: 'nutrition-nudge',
    label: 'Nutrition Nudge Experiment',
    tagline: 'Seed a simple food habit shift grounded in real-life constraints.',
    scenario:
      'Health coaches or wellness apps want a grounded prompt that helps busy people adjust one nutrition choice each day.',
    focus:
      'Clarify the nutrition outcome, characterize the persona with the moment an app nudge helps most, and document dietary, cultural, or medical boundaries for feature design.',
    angle: 'Keep the nudge approachable so app meal plans, reminders, or social loops can expand later.',
  },
  'meeting-makeover': {
    key: 'meeting-makeover',
    label: 'Meeting Makeover Sprint',
    tagline: 'Launch a focused effort to reclaim deep work while keeping collaboration strong.',
    scenario:
      'Team ops or managers want a repeatable approach to streamline recurring meetings and free up focus hours.',
    focus:
      'Spell out the collaboration outcome, describe the meeting pattern the app must diagnose, and mention any contractual, compliance, or tooling limits for the solution.',
    angle: 'Prototype a digital reset that can evolve into new norms, plays, or automation assists.',
  },
  'mobile-onboarding': {
    key: 'mobile-onboarding',
    label: 'Mobile Onboarding Glow-Up',
    tagline: 'Sharpen the first-session flow so new users feel momentum fast.',
    scenario:
      'Mobile product squads want a crisp prompt to rework onboarding for a feature-rich app without overwhelming people.',
    focus:
      'Define the activation metric, describe the persona with their device habits, and call out platform, localization, or compliance guardrails that affect onboarding flows.',
    angle: 'Aim for a lightweight revamp that future mobile experiments can layer tooltips, personalization, or coaching onto.',
  },
  'push-momentum': {
    key: 'push-momentum',
    label: 'Push Notification Momentum',
    tagline: 'Frame a respectful push campaign that nudges action without churn.',
    scenario:
      'Lifecycle teams need a mobile push series that sparks re-engagement while staying mindful of notification fatigue.',
    focus:
      'State the behaviour lift, capture the segment’s current notification cadence, and surface platform or regional limits that shape the push experience.',
    angle: 'Seed a modular app sequence that can expand with deep links, adaptive timing, or personalization.',
  },
  'ios-widget-drop': {
    key: 'ios-widget-drop',
    label: 'iOS Widget Drop',
    tagline: 'Kick off a glanceable widget concept that earns a home-screen spot.',
    scenario:
      'iOS feature teams want a starter brief for a widget that adds daily value and showcases the brand voice.',
    focus:
      'Clarify the daily job the widget solves, sketch the persona’s routine, and note iOS design system, privacy, or performance constraints that shape the widget experience.',
    angle: 'Deliver a minimal widget idea future releases can extend with interactive states or Live Activities.',
  },
  'app-store-spotlight': {
    key: 'app-store-spotlight',
    label: 'App Store Spotlight Story',
    tagline: 'Shape a feature pitch that pops in screenshots and copy.',
    scenario:
      'Growth and design partners need a tight brief to refresh App Store assets around a flagship feature or seasonal moment.',
    focus:
      'Name the story arc in plain language, describe the hero app use case with one visual hook, and include brand, legal, or localization requirements.',
    angle: 'Keep it storyboard-ready so marketing can spin up App Store creative variations across locales.',
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
    'You are an expert product strategist prepping a cross-functional team to design a new app experience.',
    'Generate a JSON object with keys: goal, audience, constraints.',
    'Write each field as 1-2 concise sentences (max 60 words) that directly inform app ideation.',
    'Unless the template scenario explicitly states another geography, anchor the opportunity in the United States market and note any US-specific nuances that matter.',
    '',
    `Template: ${definition.label}.`,
    `Scenario: ${definition.scenario}`,
    `Focus Guidance: ${definition.focus}`,
    `Strategic Angle: ${definition.angle}`,
    '',
    'Goal should spell out the app outcome, the user problem it solves, and the measurable signal of success (activation, retention, revenue, efficiency) for US stakeholders.',
    'Audience should describe the primary app users with US-specific platform context, behaviours, and the unmet need this build must solve.',
    'Constraints should capture the non-negotiable boundaries that shape shipping the app (platform limits, compliance, data, timeline, monetization, partnerships), highlighting anything pivotal for the US market.',
    'If creativity levers (storytelling hooks, social proof, partnerships) will help unlock standout app ideas, note them briefly.',
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
