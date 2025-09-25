import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { fetchGraph, fetchRunDetail, fetchRuns, startRun, briefDownloadUrl } from './api';
import { useRunStream } from './hooks/useRunStream';
import type {
  Graph,
  NodeStatus,
  PipelineRunState,
  RunDetailResponse,
  RunEvent,
} from './types';
import './App.css';

interface SeedFormState {
  goal: string;
  audience: string;
  constraints: string;
  n: string;
  k: string;
}

type NodeData = {
  status: NodeStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
};

const initialForm: SeedFormState = {
  goal: '',
  audience: '',
  constraints: '',
  n: '',
  k: '',
};

function serialize(value: unknown): string {
  if (value === undefined || value === null) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return String(value);
  }
}

function formatTimestamp(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function App() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [runs, setRuns] = useState<PipelineRunState[]>([]);
  const [form, setForm] = useState<SeedFormState>(initialForm);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [selectedNodeId, setSelectedNodeId] = useState<string>('seed');
  const [nodeDetails, setNodeDetails] = useState<Record<string, NodeData>>({});
  const [brief, setBrief] = useState<string>('');
  const [usage, setUsage] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchGraph().then(setGraph).catch(console.error);
    fetchRuns().then(setRuns).catch(console.error);
  }, []);

  useRunStream(runStatus === 'running' ? currentRunId : null, (event) => handleRunEvent(event));

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodeDetails[selectedNodeId] || null;
  }, [nodeDetails, selectedNodeId]);

  const graphNodes = graph?.nodes ?? [];

  const handleRunEvent = (event: RunEvent) => {
    if (!event) return;
    if (event.type === 'node-status') {
      setNodeDetails((prev) => ({
        ...prev,
        [event.nodeId]: {
          ...(prev[event.nodeId] || { status: 'pending' }),
          status: event.status,
          error: event.error,
          ...(event.status === 'running' ? { startedAt: event.timestamp } : { finishedAt: event.timestamp }),
        },
      }));
    } else if (event.type === 'node-io') {
      setNodeDetails((prev) => ({
        ...prev,
        [event.nodeId]: {
          ...(prev[event.nodeId] || { status: 'pending' }),
          output: event.payload,
        },
      }));
      if (event.nodeId === 'packageOutput') {
        const payload = event.payload as { brief?: string };
        if (payload?.brief) {
          setBrief(payload.brief);
        }
      }
    } else if (event.type === 'run-status') {
      setRunStatus(event.status);
      if (event.status === 'completed' || event.status === 'failed') {
        refreshRunDetail(event.runId);
      }
    }
  };

  const refreshRunDetail = async (runId: string) => {
    try {
      const detail = await fetchRunDetail(runId);
      applyRunDetail(detail);
      const updatedRuns = await fetchRuns();
      setRuns(updatedRuns);
    } catch (err) {
      console.error('Failed to load run detail', err);
    }
  };

  const applyRunDetail = (detail: RunDetailResponse) => {
    const merged: Record<string, NodeData> = {};
    for (const [nodeId, nodeState] of Object.entries(detail.state.nodes)) {
      const io = detail.nodeIO[nodeId] as Record<string, unknown> | undefined;
      const timestamps = (io?.timestamps as Record<string, string>) || {};
      merged[nodeId] = {
        status: nodeState.status,
        input: io?.input ?? nodeState.input,
        output: io?.output ?? nodeState.output,
        error: (io as any)?.error ?? nodeState.error,
        startedAt: nodeState.startedAt ?? timestamps.startedAt,
        finishedAt: nodeState.finishedAt ?? timestamps.finishedAt,
      };
    }
    setNodeDetails(merged);
    if (detail.brief) setBrief(detail.brief);
    if (detail.usage) setUsage(detail.usage);
  };

  const handleInputChange = (field: keyof SeedFormState) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const resetRunState = (seedPayload: { goal: string; audience: string; constraints: string; n?: number; k?: number }) => {
    const seedNode: NodeData = { status: 'pending', input: seedPayload, output: null };
    const divergeNode: NodeData = { status: 'pending', input: { n: seedPayload.n, seed: seedPayload }, output: null };
    const packageNode: NodeData = { status: 'pending', input: { k: seedPayload.k }, output: null };
    setNodeDetails({
      seed: seedNode,
      divergeGenerate: divergeNode,
      packageOutput: packageNode,
    });
    setBrief('');
    setUsage(null);
    setSelectedNodeId('seed');
  };

  const handleStartRun = async () => {
    setError(null);
    if (!form.goal || !form.audience || !form.constraints) {
      setError('Please fill in goal, audience, and constraints.');
      return;
    }

    const payload: { goal: string; audience: string; constraints: string; n?: number; k?: number } = {
      goal: form.goal.trim(),
      audience: form.audience.trim(),
      constraints: form.constraints.trim(),
    };
    const parsedN = form.n ? Number(form.n) : undefined;
    if (parsedN !== undefined) {
      if (!Number.isInteger(parsedN) || parsedN <= 0) {
        setError('N must be a positive integer.');
        return;
      }
      payload.n = parsedN;
    }
    const parsedK = form.k ? Number(form.k) : undefined;
    if (parsedK !== undefined) {
      if (!Number.isInteger(parsedK) || parsedK <= 0) {
        setError('K must be a positive integer.');
        return;
      }
      payload.k = parsedK;
    }

    setIsSubmitting(true);
    try {
      const response = await startRun(payload);
      setCurrentRunId(response.runId);
      setRunStatus('running');
      resetRunState(payload);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to start run.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectRun = async (run: PipelineRunState) => {
    setCurrentRunId(run.id);
    setRunStatus(run.status);
    setSelectedNodeId('seed');
    await refreshRunDetail(run.id);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Node-Graph Brainstormer</h1>
          <p className="subtitle">Seed → DivergeGenerate → PackageOutput</p>
        </div>
        <button
          className="run-button"
          onClick={handleStartRun}
          disabled={isSubmitting || runStatus === 'running'}
        >
          {isSubmitting ? 'Starting…' : runStatus === 'running' ? 'Running…' : 'Run All'}
        </button>
      </header>

      <main className="app-layout">
        <section className="panel seed-panel">
          <h2>Seed</h2>
          <label>
            Goal
            <textarea value={form.goal} onChange={handleInputChange('goal')} rows={3} />
          </label>
          <label>
            Audience
            <textarea value={form.audience} onChange={handleInputChange('audience')} rows={2} />
          </label>
          <label>
            Constraints
            <textarea value={form.constraints} onChange={handleInputChange('constraints')} rows={3} />
          </label>
          <div className="inline-fields">
            <label>
              N ideas
              <input value={form.n} onChange={handleInputChange('n')} placeholder="DEFAULT_N" />
            </label>
            <label>
              Top K
              <input value={form.k} onChange={handleInputChange('k')} placeholder="DEFAULT_K" />
            </label>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="history">
            <h3>Recent Runs</h3>
            <ul>
              {runs.map((run) => (
                <li key={run.id}>
                  <button className="history-item" onClick={() => handleSelectRun(run)}>
                    <span>{new Date(run.createdAt).toLocaleString()}</span>
                    <span className={`status status-${run.status}`}>{run.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="panel canvas-panel">
          <h2>Pipeline</h2>
          <div className="canvas">
            {graphNodes.map((node, index) => {
              const status = nodeDetails[node.id]?.status ?? 'pending';
              return (
                <div className="canvas-item" key={node.id}>
                  <button
                    className={`node-card status-${status} ${selectedNodeId === node.id ? 'selected' : ''}`}
                    onClick={() => setSelectedNodeId(node.id)}
                  >
                    <span className="node-label">{node.label}</span>
                    <span className="node-status">{status}</span>
                  </button>
                  {index < graphNodes.length - 1 && <div className="edge" aria-hidden />}
                </div>
              );
            })}
          </div>
          {currentRunId && (
            <p className="run-meta">
              Run ID: <code>{currentRunId}</code>
            </p>
          )}
        </section>

        <section className="panel inspector-panel">
          <h2>Inspector</h2>
          {selectedNode ? (
            <div className="inspector">
              <p>
                <strong>Status:</strong> <span className={`status status-${selectedNode.status}`}>{selectedNode.status}</span>
              </p>
              <p>
                <strong>Started:</strong> {formatTimestamp(selectedNode.startedAt)}
              </p>
              <p>
                <strong>Finished:</strong> {formatTimestamp(selectedNode.finishedAt)}
              </p>
              {selectedNode.error && (
                <p className="error-text">Error: {selectedNode.error}</p>
              )}
              <div>
                <h3>Input</h3>
                <pre>{serialize(selectedNode.input)}</pre>
              </div>
              <div>
                <h3>Output</h3>
                <pre>{serialize(selectedNode.output)}</pre>
              </div>
            </div>
          ) : (
            <p>Select a node to inspect inputs and outputs.</p>
          )}
        </section>

        <section className="panel output-panel">
          <h2>Output</h2>
          {brief ? (
            <>
              <pre className="brief-view">{brief}</pre>
              {currentRunId && (
                <a className="download-link" href={briefDownloadUrl(currentRunId)} download>
                  Download Markdown
                </a>
              )}
            </>
          ) : (
            <p>No brief yet. Run the pipeline to generate one.</p>
          )}
          {usage && (
            <div className="usage">
              <h3>Usage</h3>
              <pre>{serialize(usage)}</pre>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
