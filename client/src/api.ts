import type { Graph, PipelineRunState, RunDetailResponse } from './types';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:4000';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || response.statusText);
  }
  return response.json() as Promise<T>;
}

export async function fetchGraph(): Promise<Graph> {
  const res = await fetch(`${API_BASE}/graph`);
  return handleResponse<Graph>(res);
}

export async function startRun(payload: {
  goal: string;
  audience: string;
  constraints: string;
  n?: number;
  k?: number;
}): Promise<{ runId: string }> {
  const res = await fetch(`${API_BASE}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ runId: string }>(res);
}

export async function fetchRuns(): Promise<PipelineRunState[]> {
  const res = await fetch(`${API_BASE}/runs`);
  return handleResponse<PipelineRunState[]>(res);
}

export async function fetchRunDetail(runId: string): Promise<RunDetailResponse> {
  const res = await fetch(`${API_BASE}/runs/${runId}`);
  return handleResponse<RunDetailResponse>(res);
}

export function briefDownloadUrl(runId: string): string {
  return `${API_BASE}/runs/${runId}/brief`;
}

export function eventsUrl(runId: string): string {
  return `${API_BASE}/runs/${runId}/events`;
}

export async function generateRefinement(payload: {
  kind: 'ui-flow' | 'capability-breakdown' | 'experience-polish';
  idea: {
    title: string;
    description?: string;
    rationale?: string;
    risk?: string;
  };
  context?: {
    goal?: string;
    audience?: string;
    constraints?: string;
  };
}): Promise<{ fields: Record<string, string>; usage?: Record<string, unknown>; raw?: string }> {
  const res = await fetch(`${API_BASE}/refinements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ fields: Record<string, string>; usage?: Record<string, unknown>; raw?: string }>(res);
}
