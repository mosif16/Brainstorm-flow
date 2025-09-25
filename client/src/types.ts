export interface GraphNode {
  id: string;
  label: string;
  type: 'seed' | 'diverge' | 'package';
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
    };

export interface RunDetailResponse {
  state: PipelineRunState;
  nodeIO: Record<string, unknown>;
  brief?: string;
  usage?: Record<string, unknown>;
}
