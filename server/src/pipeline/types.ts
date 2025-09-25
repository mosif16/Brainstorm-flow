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
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
  cachedContentTokenCount?: number;
}

export interface SeedNodeOutput {
  title: string;
  summary: string;
  details: {
    goal: string;
    audience: string;
    constraints: string;
  };
  parameters: {
    requestedIdeas: number;
    topK: number;
  };
}

export interface DivergeNodeOutput {
  title: string;
  summary: string;
  overview: {
    ideaCount: number;
    model: string;
    requestedIdeas: number;
  };
  ideas: Idea[];
  usage: GeminiUsage;
}

export interface BriefSection {
  title: string;
  body: string;
}

export interface PackageNodeOutput {
  title: string;
  summary: string;
  metadata: {
    selectedCount: number;
    totalGenerated: number;
  };
  sections: BriefSection[];
  brief: string;
}

export interface PipelineNodeOutputs {
  seed: SeedNodeOutput;
  divergeGenerate: DivergeNodeOutput;
  packageOutput: PackageNodeOutput;
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
  nodes: PipelineNodeOutputs;
}
