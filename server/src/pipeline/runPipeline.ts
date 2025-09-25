import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import { generateIdeas } from '../services/gemini';
import type { AppConfig } from '../utils/env';
import {
  BriefSection,
  DivergeNodeOutput,
  GeminiUsage,
  Idea,
  PackageNodeOutput,
  PipelineGraph,
  PipelineOutput,
  PipelineRunState,
  SeedInput,
  SeedNodeOutput,
} from './types';

export type RunEvent =
  | {
      type: 'node-status';
      runId: string;
      nodeId: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      timestamp: string;
      error?: string;
    }
  | {
      type: 'run-status';
      runId: string;
      status: 'running' | 'completed' | 'failed';
      timestamp: string;
      error?: string;
    }
  | {
      type: 'node-io';
      runId: string;
      nodeId: string;
      payload: unknown;
    };

export type RunEmitter = EventEmitter;

export const GRAPH: PipelineGraph = {
  nodes: [
    { id: 'seed', label: 'Seed', type: 'seed' },
    { id: 'divergeGenerate', label: 'DivergeGenerate', type: 'diverge' },
    { id: 'packageOutput', label: 'PackageOutput', type: 'package' },
  ],
  edges: [
    { source: 'seed', target: 'divergeGenerate' },
    { source: 'divergeGenerate', target: 'packageOutput' },
  ],
};

const NODE_DIR = 'node_io';
const MAX_DIVERGE_IDEAS = 6;

export function createRunId(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function sanitizeSeed(seed: SeedInput): SeedInput {
  const cleaned: SeedInput = {
    goal: seed.goal?.trim() || '',
    audience: seed.audience?.trim() || '',
    constraints: seed.constraints?.trim() || '',
  };
  if (typeof seed.n === 'number') {
    cleaned.n = seed.n;
  }
  if (typeof seed.k === 'number') {
    cleaned.k = seed.k;
  }
  return cleaned;
}

function buildBrief(seed: SeedInput, ideas: Idea[], k: number): string {
  const selected = ideas.slice(0, k);
  const lines: string[] = [];
  lines.push('# Brainstorm Brief');
  lines.push('');
  lines.push(`**Goal:** ${seed.goal}`);
  lines.push(`**Audience:** ${seed.audience}`);
  lines.push(`**Constraints:** ${seed.constraints}`);
  lines.push('');
  lines.push('## Top Concepts');
  lines.push('');
  selected.forEach((idea, index) => {
    lines.push(`${index + 1}. **${idea.title}**`);
    lines.push(`   - Overview: ${idea.description}`);
    lines.push(`   - Rationale: ${idea.rationale}`);
    if (idea.risk) {
      lines.push(`   - Risk: ${idea.risk}`);
    }
    lines.push('');
  });
  lines.push('---');
  lines.push('Generated via Node-Graph Brainstormer');
  return lines.join('\n');
}

function ensureValue(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function formatConceptSummary(ideas: Idea[]): string {
  if (!ideas.length) {
    return 'No concepts selected yet. Re-run packaging once ideas are available.';
  }
  return ideas
    .map((idea, index) => {
      const base = `${index + 1}. ${idea.title} — ${idea.description} Rationale: ${idea.rationale}`;
      if (idea.risk) {
        return `${base} Risk Watch: ${idea.risk}`;
      }
      return base;
    })
    .join('\n');
}

function buildPackageSections(
  seed: SeedInput,
  selectedIdeas: Idea[],
  totalGenerated: number,
  selectedCount: number,
): BriefSection[] {
  const goal = ensureValue(seed.goal, 'Goal not specified.');
  const audience = ensureValue(seed.audience, 'Audience not specified.');
  const constraints = ensureValue(seed.constraints, 'Constraints not specified.');
  const conceptSummary = formatConceptSummary(selectedIdeas);

  return [
    { title: 'Objective', body: goal },
    { title: 'Target Audience', body: audience },
    { title: 'Guardrails', body: constraints },
    { title: 'Concept Snapshot', body: conceptSummary },
    {
      title: 'Engagement Summary',
      body: `Generated ${totalGenerated} structured concepts and elevated the top ${selectedCount} for packaging.`,
    },
  ];
}

async function persistNodeIO(
  runDir: string,
  nodeId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const nodeDir = path.join(runDir, NODE_DIR);
  await ensureDir(nodeDir);
  await writeJson(path.join(nodeDir, `${nodeId}.json`), data);
}

async function persistGraph(runDir: string): Promise<void> {
  await writeJson(path.join(runDir, 'graph.json'), GRAPH);
}

async function persistBrief(runDir: string, brief: string): Promise<void> {
  await fs.writeFile(path.join(runDir, 'brief.md'), brief, 'utf-8');
}

async function persistUsage(runDir: string, usage: unknown): Promise<void> {
  await writeJson(path.join(runDir, 'token_usage.json'), usage);
}

async function persistRunState(runDir: string, state: PipelineRunState): Promise<void> {
  await writeJson(path.join(runDir, 'state.json'), state);
}

export async function runPipeline(
  config: AppConfig,
  seed: SeedInput,
  emitter: RunEmitter,
  runId = createRunId(),
): Promise<PipelineOutput> {
  await ensureDir(config.runsDir);
  const runDir = path.join(config.runsDir, runId);
  await ensureDir(runDir);
  await persistGraph(runDir);

  let sanitized = sanitizeSeed(seed);
  const requestedIdeas = sanitized.n ?? config.defaultN;
  const requestedTopK = sanitized.k ?? config.defaultK;
  const ideaCount = Math.min(MAX_DIVERGE_IDEAS, requestedIdeas);
  const effectiveTopK = Math.max(1, Math.min(requestedTopK, ideaCount));
  const wasIdeaCountCapped = requestedIdeas !== ideaCount;
  const wasTopKCapped = requestedTopK !== effectiveTopK;

  sanitized = {
    ...sanitized,
    n: ideaCount,
    k: effectiveTopK,
  };

  const state: PipelineRunState = {
    id: runId,
    createdAt: new Date().toISOString(),
    status: 'running',
    nodes: {
      seed: {
        id: 'seed',
        label: 'Seed',
        status: 'pending',
        input: sanitized,
        output: null,
      },
      divergeGenerate: {
        id: 'divergeGenerate',
        label: 'DivergeGenerate',
        status: 'pending',
        input: null,
        output: null,
      },
      packageOutput: {
        id: 'packageOutput',
        label: 'PackageOutput',
        status: 'pending',
        input: null,
        output: null,
      },
    },
  };

  await persistRunState(runDir, state);
  emitter.emit('event', { type: 'run-status', runId, status: 'running', timestamp: state.createdAt });

  type NodeKey = keyof PipelineRunState['nodes'];

  const updateNode = async (
    nodeId: NodeKey,
    updates: Partial<PipelineRunState['nodes'][NodeKey]>,
  ) => {
    state.nodes[nodeId] = { ...state.nodes[nodeId], ...updates };
    await persistRunState(runDir, state);
  };

  const markNodeStatus = async (
    nodeId: NodeKey,
    status: 'pending' | 'running' | 'completed' | 'failed',
    error?: string,
  ) => {
    const timestamp = new Date().toISOString();
    const updates: Partial<PipelineRunState['nodes'][NodeKey]> = {
      status,
      ...(status === 'running' ? { startedAt: timestamp } : { finishedAt: timestamp }),
    };
    if (status === 'failed' && error) {
      updates.error = error;
    }
    await updateNode(nodeId, updates);
    emitter.emit('event', { type: 'node-status', runId, nodeId, status, timestamp, error });
  };

  const plannedTopK = sanitized.k ?? effectiveTopK;
  const ideaSummaryText = wasIdeaCountCapped
    ? `${ideaCount} (capped from ${requestedIdeas})`
    : `${ideaCount}`;
  const topKSummaryText = wasTopKCapped
    ? `${plannedTopK} (capped from ${requestedTopK})`
    : `${plannedTopK}`;

  await markNodeStatus('seed', 'running');
  const seedOutput: SeedNodeOutput = {
    title: 'Seed Summary',
    summary: `Prepared seed brief requesting ${ideaSummaryText} ideas and spotlighting the top ${topKSummaryText} for packaging.`,
    details: {
      goal: sanitized.goal,
      audience: sanitized.audience,
      constraints: sanitized.constraints,
    },
    parameters: {
      requestedIdeas: ideaCount,
      topK: plannedTopK,
    },
  };
  await updateNode('seed', {
    output: seedOutput,
  });
  await markNodeStatus('seed', 'completed');
  await persistNodeIO(runDir, 'seed', {
    nodeId: 'seed',
    status: 'completed',
    input: sanitized,
    output: seedOutput,
    timestamps: {
      startedAt: state.nodes.seed.startedAt,
      finishedAt: state.nodes.seed.finishedAt,
    },
  });
  emitter.emit('event', { type: 'node-io', runId, nodeId: 'seed', payload: seedOutput });

  await markNodeStatus('divergeGenerate', 'running');

  let ideas: Idea[] = [];
  let usageMeta: GeminiUsage = {};
  let divergeOutput: DivergeNodeOutput | null = null;

  try {
    const start = new Date().toISOString();
    const { ideas: generatedIdeas, usage, raw } = await generateIdeas(config, sanitized, ideaCount);
    const limitedIdeas = generatedIdeas.slice(0, ideaCount);
    ideas = limitedIdeas;
    usageMeta = usage;
    const conceptCount = limitedIdeas.length;
    const pluralSuffix = conceptCount === 1 ? '' : 's';
    divergeOutput = {
      title: 'Structured Idea Portfolio',
      summary: `Generated ${conceptCount} structured concept${pluralSuffix} leveraging ${config.geminiModel}.`,
      overview: {
        ideaCount: conceptCount,
        model: config.geminiModel,
        requestedIdeas: ideaCount,
      },
      ideas: limitedIdeas,
      usage: usageMeta,
    };
    await updateNode('divergeGenerate', {
      input: { n: ideaCount, seed: sanitized },
      output: divergeOutput,
      finishedAt: new Date().toISOString(),
      startedAt: state.nodes.divergeGenerate.startedAt ?? start,
    });
    await markNodeStatus('divergeGenerate', 'completed');
    await persistNodeIO(runDir, 'divergeGenerate', {
      nodeId: 'divergeGenerate',
      status: 'completed',
      input: { n: ideaCount, seed: sanitized },
      output: divergeOutput,
      usage: usageMeta,
      raw,
      timestamps: {
        startedAt: state.nodes.divergeGenerate.startedAt ?? start,
        finishedAt: state.nodes.divergeGenerate.finishedAt,
      },
    });
    emitter.emit('event', {
      type: 'node-io',
      runId,
      nodeId: 'divergeGenerate',
      payload: divergeOutput,
    });
  } catch (error) {
    const message = (error as Error).message;
    await updateNode('divergeGenerate', {
      input: { n: ideaCount, seed: sanitized },
      error: message,
    });
    await markNodeStatus('divergeGenerate', 'failed', message);
    await persistNodeIO(runDir, 'divergeGenerate', {
      nodeId: 'divergeGenerate',
      status: 'failed',
      input: { n: ideaCount, seed: sanitized },
      error: message,
      timestamps: {
        startedAt: state.nodes.divergeGenerate.startedAt,
        finishedAt: state.nodes.divergeGenerate.finishedAt,
      },
    });
    emitter.emit('event', {
      type: 'run-status',
      runId,
      status: 'failed',
      timestamp: new Date().toISOString(),
      error: message,
    });
    state.status = 'failed';
    state.error = message;
    await persistRunState(runDir, state);
    throw error;
  }

  const k = Math.max(1, Math.min(ideas.length, plannedTopK));
  await markNodeStatus('packageOutput', 'running');
  const brief = buildBrief(sanitized, ideas, k);
  const selectedIdeas = ideas.slice(0, k);
  const selectedCount = selectedIdeas.length;
  const packageSections = buildPackageSections(sanitized, selectedIdeas, ideas.length, selectedCount);
  const packageSummary =
    selectedCount > 0
      ? `Curated the top ${selectedCount} concept${selectedCount === 1 ? '' : 's'} into a stakeholder-ready brief.`
      : 'Prepared a brief shell; regenerate concepts to populate the highlights.';
  const packageOutput: PackageNodeOutput = {
    title: 'Executive Creative Brief',
    summary: packageSummary,
    metadata: {
      selectedCount,
      totalGenerated: ideas.length,
    },
    sections: packageSections,
    brief,
  };
  await updateNode('packageOutput', {
    input: { k, ideas },
    output: packageOutput,
  });
  await markNodeStatus('packageOutput', 'completed');
  await persistNodeIO(runDir, 'packageOutput', {
    nodeId: 'packageOutput',
    status: 'completed',
    input: { k, ideas },
    output: packageOutput,
    timestamps: {
      startedAt: state.nodes.packageOutput.startedAt,
      finishedAt: state.nodes.packageOutput.finishedAt,
    },
  });
  await persistBrief(runDir, brief);
  emitter.emit('event', { type: 'node-io', runId, nodeId: 'packageOutput', payload: packageOutput });

  state.status = 'completed';
  state.usage = usageMeta;
  await persistRunState(runDir, state);
  await persistUsage(runDir, usageMeta);
  emitter.emit('event', { type: 'run-status', runId, status: 'completed', timestamp: new Date().toISOString() });

  const finalDivergeOutput: DivergeNodeOutput =
    divergeOutput ?? {
      title: 'Structured Idea Portfolio',
      summary: 'No concepts generated during this run.',
      overview: {
        ideaCount: ideas.length,
        model: config.geminiModel,
        requestedIdeas: ideaCount,
      },
      ideas,
      usage: usageMeta,
    };

  return {
    runId,
    ideas,
    brief,
    usage: usageMeta,
    nodes: {
      seed: seedOutput,
      divergeGenerate: finalDivergeOutput,
      packageOutput,
    },
  } satisfies PipelineOutput;
}
