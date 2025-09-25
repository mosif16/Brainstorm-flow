export interface SeedInput {
  goal: string;
  audience: string;
  constraints: string;
  n?: number;
  k?: number;
}

export interface Idea {
  title: string;
  description: string;
  rationale: string;
  risk?: string;
}

export interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

export type NodeId = 'seed' | 'divergeGenerate' | 'packageOutput';

export interface NodeResult<TInput, TOutput> {
  id: NodeId;
  label: string;
  input: TInput | null;
  output: TOutput | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface PipelineGraph {
  nodes: Array<{ id: NodeId; label: string; type: 'seed' | 'diverge' | 'package' }>;
  edges: Array<{ source: NodeId; target: NodeId }>;
}

export interface PipelineRunState {
  id: string;
  createdAt: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
  nodes: Record<NodeId, NodeResult<unknown, unknown>>;
  usage?: GeminiUsage;
}

export interface PipelineOutput {
  runId: string;
  ideas: Idea[];
  brief: string;
  usage: GeminiUsage;
}
