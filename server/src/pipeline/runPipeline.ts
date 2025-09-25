import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import { generateIdeas } from '../services/gemini';
import type { AppConfig } from '../utils/env';
import {
  GeminiUsage,
  Idea,
  PipelineGraph,
  PipelineOutput,
  PipelineRunState,
  SeedInput,
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

  const sanitized = sanitizeSeed(seed);

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

  await markNodeStatus('seed', 'running');
  await updateNode('seed', {
    output: sanitized,
  });
  await markNodeStatus('seed', 'completed');
  await persistNodeIO(runDir, 'seed', {
    nodeId: 'seed',
    status: 'completed',
    input: sanitized,
    output: sanitized,
    timestamps: {
      startedAt: state.nodes.seed.startedAt,
      finishedAt: state.nodes.seed.finishedAt,
    },
  });
  emitter.emit('event', { type: 'node-io', runId, nodeId: 'seed', payload: sanitized });

  const ideaCount = sanitized.n ?? config.defaultN;
  await markNodeStatus('divergeGenerate', 'running');

  let ideas: Idea[] = [];
  let usageMeta: GeminiUsage = {};

  try {
    const start = new Date().toISOString();
    const { ideas: generatedIdeas, usage, raw } = await generateIdeas(config, sanitized, ideaCount);
    ideas = generatedIdeas;
    usageMeta = usage;
    await updateNode('divergeGenerate', {
      input: { n: ideaCount, seed: sanitized },
      output: { ideas: generatedIdeas },
      finishedAt: new Date().toISOString(),
      startedAt: state.nodes.divergeGenerate.startedAt ?? start,
    });
    await markNodeStatus('divergeGenerate', 'completed');
    await persistNodeIO(runDir, 'divergeGenerate', {
      nodeId: 'divergeGenerate',
      status: 'completed',
      input: { n: ideaCount, seed: sanitized },
      output: { ideas: generatedIdeas },
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
      payload: { ideas: generatedIdeas },
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

  const k = Math.max(1, Math.min(ideas.length, sanitized.k ?? config.defaultK));
  await markNodeStatus('packageOutput', 'running');
  const brief = buildBrief(sanitized, ideas, k);
  await updateNode('packageOutput', {
    input: { k, ideas },
    output: { brief },
  });
  await markNodeStatus('packageOutput', 'completed');
  await persistNodeIO(runDir, 'packageOutput', {
    nodeId: 'packageOutput',
    status: 'completed',
    input: { k, ideas },
    output: { brief },
    timestamps: {
      startedAt: state.nodes.packageOutput.startedAt,
      finishedAt: state.nodes.packageOutput.finishedAt,
    },
  });
  await persistBrief(runDir, brief);
  emitter.emit('event', { type: 'node-io', runId, nodeId: 'packageOutput', payload: { brief } });

  state.status = 'completed';
  state.usage = usageMeta;
  await persistRunState(runDir, state);
  await persistUsage(runDir, usageMeta);
  emitter.emit('event', { type: 'run-status', runId, status: 'completed', timestamp: new Date().toISOString() });

  return { runId, ideas, brief, usage: usageMeta } satisfies PipelineOutput;
}
