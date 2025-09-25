export interface GraphNode {
  id: string;
  label: string;
  type: 'seed' | 'diverge' | 'idea';
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface NodeState {
  id: string;
  label: string;
  status: NodeStatus;
  input: unknown;
  output: unknown;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface PipelineRunState {
  id: string;
  createdAt: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
  nodes: Record<string, NodeState>;
  usage?: Record<string, unknown>;
  packagedBrief?: PackagedBrief;
}

export interface BrainstormIdea {
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
  ideas: BrainstormIdea[];
  usage: GeminiUsage;
}

export interface BriefSection {
  title: string;
  body: string;
}

export interface PackagedBrief {
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
}

export type RunEvent =
  | {
      type: 'node-status';
      runId: string;
      nodeId: string;
      status: NodeStatus;
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
    }
  | {
      type: 'packaged-brief';
      runId: string;
      payload: PackagedBrief;
      timestamp: string;
    };

export interface RunDetailResponse {
  state: PipelineRunState;
  nodeIO: Record<string, unknown>;
  brief?: string;
  usage?: Record<string, unknown>;
  packagedBrief?: PackagedBrief;
}
