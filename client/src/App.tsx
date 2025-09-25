import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
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

type IdeaPreview = {
  title: string;
  description?: string;
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

interface DevSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function DevSection({ title, isOpen, onToggle, children }: DevSectionProps) {
  return (
    <section className={`inspector-section ${isOpen ? 'expanded' : 'collapsed'}`}>
      <div className="section-header">
        <h3>{title}</h3>
        <button type="button" className="section-toggle" aria-expanded={isOpen} onClick={onToggle}>
          {isOpen ? 'Hide' : 'Show'}
        </button>
      </div>
      {isOpen && <div className="section-body">{children}</div>}
    </section>
  );
}

export default function App() {
  const edgeColorByStatus: Record<NodeStatus, string> = {
    pending: '#2d3c4f',
    running: '#5a8dee',
    completed: '#3dad75',
    failed: '#ff7a7a',
  };
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
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isSeedConfigOpen, setIsSeedConfigOpen] = useState(true);
  const [isInspectorSectionOpen, setIsInspectorSectionOpen] = useState(true);
  const [isOutputSectionOpen, setIsOutputSectionOpen] = useState(true);
  const [isUsageSectionOpen, setIsUsageSectionOpen] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [expandedPreviews, setExpandedPreviews] = useState<Record<string, boolean>>({});
  const canvasContentRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragStateRef = useRef({
    nodeId: null as string | null,
    pointerId: null as number | null,
    originX: 0,
    originY: 0,
    pointerStartX: 0,
    pointerStartY: 0,
    wasDragging: false,
  });
  const [edgeLines, setEdgeLines] = useState<
    {
      id: string;
      sourceId: string;
      targetId: string;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      midX: number;
      midY: number;
      status: NodeStatus;
      sourceLabel: string;
      targetLabel: string;
      summary: string;
    }[]
  >([]);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [hoveredEdge, setHoveredEdge] = useState<
    | {
        id: string;
        x: number;
        y: number;
        status: NodeStatus;
        sourceLabel: string;
        targetLabel: string;
        summary: string;
      }
    | null
  >(null);

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
  const graphNodeById = useMemo(() => {
    const map: Record<string, Graph['nodes'][number]> = {};
    for (const node of graphNodes) {
      map[node.id] = node;
    }
    return map;
  }, [graphNodes]);

  useEffect(() => {
    if (!graphNodes.length) return;
    setNodePositions((prev) => {
      let changed = false;
      const next: Record<string, { x: number; y: number }> = { ...prev };

      for (const node of graphNodes) {
        if (!next[node.id]) {
          next[node.id] = { x: 0, y: 0 };
          changed = true;
        }
      }

      for (const existingId of Object.keys(next)) {
        if (!graphNodes.some((node) => node.id === existingId)) {
          delete next[existingId];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [graphNodes]);

  const measureEdges = useCallback(() => {
    const canvasEl = canvasContentRef.current;
    if (!canvasEl || !graph?.edges?.length) {
      setEdgeLines([]);
      setCanvasSize({ width: 0, height: 0 });
      return;
    }

    const canvasRect = canvasEl.getBoundingClientRect();
    const nextLines: {
      id: string;
      sourceId: string;
      targetId: string;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      midX: number;
      midY: number;
      status: NodeStatus;
      sourceLabel: string;
      targetLabel: string;
      summary: string;
    }[] = [];

    let hasMeasurements = false;

    for (const edge of graph.edges) {
      const sourceEl = nodeRefs.current[edge.source];
      const targetEl = nodeRefs.current[edge.target];
      if (!sourceEl || !targetEl) continue;

      const sourceRect = sourceEl.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();

      const anchorOffset = 12;
      const startX = sourceRect.right - canvasRect.left + anchorOffset;
      const startY = sourceRect.top + sourceRect.height / 2 - canvasRect.top;
      const endX = targetRect.left - canvasRect.left - anchorOffset;
      const endY = targetRect.top + targetRect.height / 2 - canvasRect.top;
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      const sourceStatus = nodeDetails[edge.source]?.status;
      const targetStatus = nodeDetails[edge.target]?.status;
      const status: NodeStatus = sourceStatus || targetStatus || 'pending';
      const sourceLabel = graphNodeById[edge.source]?.label || edge.source;
      const targetLabel = graphNodeById[edge.target]?.label || edge.target;

      const sourceOutput = nodeDetails[edge.source]?.output;
      let summary = 'No output yet';
      if (sourceOutput) {
        if (Array.isArray(sourceOutput)) {
          summary = sourceOutput.length === 1 ? '1 item emitted' : `${sourceOutput.length} items emitted`;
        } else if (typeof sourceOutput === 'object') {
          const keys = Object.keys(sourceOutput as Record<string, unknown>);
          summary = keys.length ? `Output keys: ${keys.slice(0, 3).join(', ')}` : 'Output ready';
        } else {
          summary = 'Output ready';
        }
      }

      nextLines.push({
        id: `${edge.source}→${edge.target}`,
        sourceId: edge.source,
        targetId: edge.target,
        startX,
        startY,
        endX,
        endY,
        midX,
        midY,
        status,
        sourceLabel,
        targetLabel,
        summary,
      });
      hasMeasurements = true;
    }

    if (!hasMeasurements || !nextLines.length) {
      setEdgeLines([]);
      setCanvasSize({ width: 0, height: 0 });
      return;
    }
    setEdgeLines(nextLines);
    setCanvasSize({ width: canvasRect.width, height: canvasRect.height });
  }, [graph?.edges, graphNodeById, nodeDetails]);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => {
      measureEdges();
    });
    return () => cancelAnimationFrame(raf);
  }, [measureEdges, graphNodes, nodePositions, zoom]);

  useEffect(() => {
    measureEdges();
    window.addEventListener('resize', measureEdges);
    return () => {
      window.removeEventListener('resize', measureEdges);
    };
  }, [measureEdges]);

  useEffect(() => {
    if (!hoveredEdge) return;
    if (!edgeLines.some((edge) => edge.id === hoveredEdge.id)) {
      setHoveredEdge(null);
    }
  }, [edgeLines, hoveredEdge]);

  useEffect(() => {
    if (draggingNodeId) {
      setHoveredEdge(null);
    }
  }, [draggingNodeId]);

  const resetDragState = () => {
    dragStateRef.current = {
      nodeId: null,
      pointerId: null,
      originX: 0,
      originY: 0,
      pointerStartX: 0,
      pointerStartY: 0,
      wasDragging: false,
    };
    setDraggingNodeId(null);
  };

  const handleNodePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, nodeId: string) => {
    if (event.button !== 0) return;
    const position = nodePositions[nodeId] ?? { x: 0, y: 0 };
    dragStateRef.current = {
      nodeId,
      pointerId: event.pointerId,
      originX: position.x,
      originY: position.y,
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      wasDragging: false,
    };

    if (event.currentTarget.setPointerCapture) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (err) {
        console.error('Failed to set pointer capture', err);
      }
    }
  };

  const handleNodePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current;
    if (!state.nodeId || state.pointerId !== event.pointerId) return;

    const dx = (event.clientX - state.pointerStartX) / zoom;
    const dy = (event.clientY - state.pointerStartY) / zoom;

    if (!state.wasDragging) {
      const distance = Math.hypot(dx, dy);
      if (distance < 3) return;
      state.wasDragging = true;
      setDraggingNodeId(state.nodeId);
    }

    const nextX = state.originX + dx;
    const nextY = state.originY + dy;

    setNodePositions((prev) => {
      const current = prev[state.nodeId as string] ?? { x: 0, y: 0 };
      if (current.x === nextX && current.y === nextY) return prev;
      return {
        ...prev,
        [state.nodeId as string]: { x: nextX, y: nextY },
      };
    });

    event.preventDefault();
  };

  const handleNodePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current;
    if (state.pointerId !== event.pointerId) return;
    if (state.wasDragging) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.currentTarget.releasePointerCapture) {
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch (err) {
        console.error('Failed to release pointer capture', err);
      }
    }
    resetDragState();
  };

  const handleNodePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = dragStateRef.current;
    if (state.pointerId !== event.pointerId) return;
    if (event.currentTarget.releasePointerCapture) {
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch (err) {
        console.error('Failed to release pointer capture', err);
      }
    }
    resetDragState();
  };

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

  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 1.75;
  const ZOOM_STEP = 0.15;

  const tidyText = useCallback((value: string): string => {
    if (!value) return '';
    const cleanedLines = value
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim().replace(/^(?:[#>*-]|\d+\.)\s*/g, ''))
      .filter((line) => line.length > 0);
    const joined = cleanedLines.join(' ').replace(/\s{2,}/g, ' ').trim();
    return joined.replace(/[\*`_]+/g, '').trim();
  }, []);

  const extractIdeas = useCallback((value: unknown): IdeaPreview[] => {
    if (!value || typeof value !== 'object') return [];
    const ideasValue = (value as { ideas?: unknown }).ideas;
    if (!Array.isArray(ideasValue)) return [];
    const sanitized: IdeaPreview[] = [];
    for (const idea of ideasValue) {
      if (!idea || typeof idea !== 'object') continue;
      const { title, description } = idea as Record<string, unknown>;
      if (typeof title !== 'string') continue;
      const cleanedTitle = tidyText(title);
      if (!cleanedTitle) continue;
      const cleanedDescription =
        typeof description === 'string' && description.trim() ? tidyText(description) : undefined;
      sanitized.push({
        title: cleanedTitle,
        ...(cleanedDescription ? { description: cleanedDescription } : {}),
      });
    }
    return sanitized;
  }, [tidyText]);

  const extractBrief = useCallback((value: unknown): string | null => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      const maybeBrief = (value as { brief?: unknown }).brief;
      if (typeof maybeBrief === 'string') return maybeBrief;
    }
    return null;
  }, []);

  const togglePreviewExpansion = useCallback((nodeId: string) => {
    setExpandedPreviews((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  }, []);

  const truncateText = useCallback(
    (value: string, limit: number) => {
      const normalized = tidyText(value);
      if (!normalized) return '';
      if (normalized.length <= limit) return normalized;
      return `${normalized.slice(0, Math.max(0, limit - 1)).trim()}…`;
    },
    [tidyText],
  );

  const formatBriefHeading = useCallback(
    (raw: string, index: number) => {
      const sanitized = tidyText(raw) || `Section ${index + 1}`;
      const tokens = sanitized.split(/\s+/);
      const primary = tokens[0] || `Section ${index + 1}`;
      const secondary = tokens.slice(1).join(' ');
      return {
        primary,
        secondary: secondary ? `▌ ${secondary}` : '',
      };
    },
    [tidyText],
  );

  const getNodeTiming = useCallback((node: NodeData | undefined) => {
    const timestamp = node?.finishedAt ?? node?.startedAt;
    if (!timestamp) return null;
    return <p className="node-card-meta">Updated {formatTimestamp(timestamp)}</p>;
  }, []);

  const renderNodePreview = useCallback(
    (nodeId: string, node: NodeData | undefined) => {
      const isExpanded = expandedPreviews[nodeId] ?? false;
      const handleToggle = () => togglePreviewExpansion(nodeId);

      if (!node || node.status === 'pending') {
        return (
          <div className="node-preview muted">
            <p className="node-card-info muted">Awaiting output.</p>
          </div>
        );
      }

      if (node.error) {
        return (
          <div className="node-preview">
            <p className="error-text">Error: {node.error}</p>
          </div>
        );
      }

      if (nodeId === 'divergeGenerate') {
        const ideas = extractIdeas(node.output);
        if (!ideas.length) {
          return (
            <div className="node-preview muted">
              <p className="node-card-info muted">No ideas captured yet.</p>
            </div>
          );
        }
        const MAX_VISIBLE = 5;
        const visibleIdeas = isExpanded ? ideas : ideas.slice(0, MAX_VISIBLE);
        const hiddenCount = ideas.length - visibleIdeas.length;

        return (
          <div className="node-preview">
            <div className="node-preview-header">
              <span className="node-preview-title">Ideas</span>
              <span className="node-preview-meta">{ideas.length} idea{ideas.length === 1 ? '' : 's'}</span>
            </div>
            <div className="idea-card-list" aria-label="Generated ideas">
              {visibleIdeas.map((idea, index) => {
                const description = idea.description
                  ? isExpanded
                    ? idea.description
                    : truncateText(idea.description, 120)
                  : null;
                return (
                  <article key={`${idea.title}-${index}`} className="idea-card">
                    <h4>{idea.title}</h4>
                    {description && <p>{description}</p>}
                  </article>
                );
              })}
            </div>
            {hiddenCount > 0 && (
              <button type="button" className="node-preview-toggle" onClick={handleToggle}>
                {isExpanded ? 'Collapse list' : `Show ${hiddenCount} more`}
              </button>
            )}
          </div>
        );
      }

      if (nodeId === 'packageOutput') {
        const briefSnippet = extractBrief(node.output);
        if (!briefSnippet) {
          return (
            <div className="node-preview muted">
              <p className="node-card-info muted">Brief will appear after packaging.</p>
            </div>
          );
        }

        const wordCount = briefSnippet.trim() ? briefSnippet.trim().split(/\s+/).length : 0;
        const sections = briefSnippet
          .split(/\n{2,}/)
          .map((section) => section.trim())
          .filter(Boolean);
        const cleanedSections = sections
          .map((section) => tidyText(section))
          .filter((section) => section.length > 0);
        const MAX_SECTIONS = 2;
        const visibleSections = isExpanded
          ? cleanedSections
          : cleanedSections.slice(0, MAX_SECTIONS);
        const hiddenCount = cleanedSections.length - visibleSections.length;

        const briefClassName = `brief-preview ${isExpanded ? 'expanded' : ''}`.trim();

        return (
          <div className="node-preview">
            <div className="node-preview-header">
              <span className="node-preview-title">Packaged Brief</span>
              <span className="node-preview-meta">{wordCount} words</span>
            </div>
            <div className={briefClassName} aria-label="Brief preview">
              {visibleSections.map((section, index) => {
                const colonIndex = section.indexOf(':');
                let heading = `Section ${index + 1}`;
                let body = section;
                if (colonIndex > 0 && colonIndex < 80) {
                  heading = tidyText(section.slice(0, colonIndex));
                  body = tidyText(section.slice(colonIndex + 1));
                }
                const displayBody = isExpanded ? body : truncateText(body, 240);
                const { primary, secondary } = formatBriefHeading(heading, index);
                return (
                  <section key={`${index}-${section.slice(0, 8)}`} className="brief-section">
                    <div className="brief-section-heading" aria-hidden="true">
                      <span className="brief-section-heading-main">{primary}</span>
                      {secondary && <span className="brief-section-heading-sub">{secondary}</span>}
                    </div>
                    <h4 className="sr-only">{heading}</h4>
                    <p>{displayBody}</p>
                  </section>
                );
              })}
            </div>
            {hiddenCount > 0 && (
              <button type="button" className="node-preview-toggle" onClick={handleToggle}>
                {isExpanded
                  ? 'Collapse brief'
                  : `Show ${hiddenCount} more section${hiddenCount > 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        );
      }

      if (nodeId === 'seed') {
        const seedInput = node.output as
          |
            {
              goal?: string;
              audience?: string;
              constraints?: string;
            }
          | undefined;
        if (!seedInput) return null;
        const goalText = tidyText(seedInput.goal || '—');
        const audienceText = tidyText(seedInput.audience || '—');
        const constraintsText = tidyText(seedInput.constraints || '—');
        return (
          <div className="node-preview">
            <div className="node-preview-header">
              <span className="node-preview-title">Seed</span>
            </div>
            <ul className="seed-summary">
              <li>
                <span>Goal</span>
                <strong>{truncateText(goalText, 140)}</strong>
              </li>
              <li>
                <span>Audience</span>
                <strong>{truncateText(audienceText, 140)}</strong>
              </li>
              <li>
                <span>Constraints</span>
                <strong>{truncateText(constraintsText, 160)}</strong>
              </li>
            </ul>
          </div>
        );
      }

      return null;
    },
    [
      expandedPreviews,
      extractBrief,
      extractIdeas,
      formatBriefHeading,
      tidyText,
      togglePreviewExpansion,
      truncateText,
    ],
  );

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(MAX_ZOOM, Number((prev + ZOOM_STEP).toFixed(2))));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(MIN_ZOOM, Number((prev - ZOOM_STEP).toFixed(2))));
  };

  const handleZoomReset = () => {
    setZoom(1);
  };

  const canZoomIn = zoom < MAX_ZOOM;
  const canZoomOut = zoom > MIN_ZOOM;
  const showReset = zoom !== 1;

  const appShellClassName = `app-shell ${isInspectorOpen ? 'dev-open' : ''}`.trim();

  return (
    <div className={appShellClassName}>
      <main className="app-layout">
        <section className="panel canvas-panel">
          <div className="pipeline-top">
            <div>
              <h2>Pipeline</h2>
              <p className="pipeline-subtitle">Seed inputs live in the Seed node card.</p>
            </div>
            <div className="pipeline-actions">
              <div className="zoom-controls" role="group" aria-label="Canvas zoom">
                <button
                  type="button"
                  className="zoom-button"
                  onClick={handleZoomOut}
                  disabled={!canZoomOut}
                  aria-label="Zoom out"
                >
                  −
                </button>
                <span className="zoom-level" aria-live="polite">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  className="zoom-button"
                  onClick={handleZoomIn}
                  disabled={!canZoomIn}
                  aria-label="Zoom in"
                >
                  +
                </button>
                {showReset && (
                  <button type="button" className="zoom-reset" onClick={handleZoomReset}>
                    Reset
                  </button>
                )}
              </div>
              <button
                className="run-button inline"
                onClick={handleStartRun}
                disabled={isSubmitting || runStatus === 'running'}
              >
                {isSubmitting ? 'Starting…' : runStatus === 'running' ? 'Running…' : 'Run All'}
              </button>
            </div>
          </div>
          <div className="canvas">
            <div
              className="canvas-content"
              ref={canvasContentRef}
              style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
            >
              {canvasSize.width > 0 && canvasSize.height > 0 && edgeLines.length > 0 && (
                <svg
                  className="canvas-edges"
                  viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}
              preserveAspectRatio="none"
            >
              <defs>
                <marker
                  id="canvas-edge-arrow"
                      markerWidth="16"
                      markerHeight="16"
                      refX="12"
                      refY="8"
                      orient="auto"
                      markerUnits="userSpaceOnUse"
                    >
                      <path d="M 0 0 L 16 8 L 0 16 Z" className="canvas-edge-arrow" />
                    </marker>
                  </defs>
                  {edgeLines.map((edge) => {
                    const deltaX = edge.endX - edge.startX;
                    const deltaY = edge.endY - edge.startY;
                    const horizontalPull = Math.max(Math.abs(deltaX) * 0.45, 80);
                    const direction = Math.sign(deltaX || 1);
                    const rawC1x = edge.startX + direction * horizontalPull;
                    const rawC2x = edge.endX - direction * horizontalPull;
                    const verticalPull = deltaY * 0.25;
                    const c1y = edge.startY + verticalPull;
                    const c2y = edge.endY - verticalPull;
                    const minControl = Math.min(edge.startX, edge.endX) - 120;
                    const maxControl = Math.max(edge.startX, edge.endX) + 120;
                    const clamp = (value: number) => Math.max(minControl, Math.min(maxControl, value));
                    const c1x = clamp(rawC1x);
                    const c2x = clamp(rawC2x);

                    const path = `M ${edge.startX} ${edge.startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${edge.endX} ${edge.endY}`;
                    return (
                      <path
                        key={edge.id}
                        d={path}
                        className={`canvas-edge status-${edge.status}`}
                        style={{ color: edgeColorByStatus[edge.status] }}
                        markerEnd="url(#canvas-edge-arrow)"
                        onPointerEnter={() =>
                          setHoveredEdge({
                            id: edge.id,
                            x: edge.midX,
                            y: edge.midY,
                            status: edge.status,
                            sourceLabel: edge.sourceLabel,
                            targetLabel: edge.targetLabel,
                            summary: edge.summary,
                          })
                        }
                        onPointerLeave={() => setHoveredEdge(null)}
                        onFocus={() =>
                          setHoveredEdge({
                            id: edge.id,
                            x: edge.midX,
                            y: edge.midY,
                            status: edge.status,
                            sourceLabel: edge.sourceLabel,
                            targetLabel: edge.targetLabel,
                            summary: edge.summary,
                          })
                        }
                        onBlur={() => setHoveredEdge(null)}
                        tabIndex={0}
                      />
                    );
                  })}
                </svg>
              )}
              {hoveredEdge && (
                <div
                  className={`canvas-edge-tooltip status-${hoveredEdge.status}`}
                  style={{ left: hoveredEdge.x, top: hoveredEdge.y }}
                  role="status"
                >
                  <p className="tooltip-title">
                    {hoveredEdge.sourceLabel} → {hoveredEdge.targetLabel}
                  </p>
                  <p className="tooltip-summary">{hoveredEdge.summary}</p>
                  <p className="tooltip-status">Status: {hoveredEdge.status}</p>
                </div>
              )}
              {graphNodes.map((node) => {
                const nodeData = nodeDetails[node.id];
                const status = nodeData?.status ?? 'pending';
                const isSeedNode = node.id === 'seed';
                const position = nodePositions[node.id] ?? { x: 0, y: 0 };
                const isDragging = draggingNodeId === node.id;
                return (
                  <div
                    className={`canvas-item ${isDragging ? 'dragging' : ''}`}
                    key={node.id}
                    style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
                    ref={(el) => {
                      nodeRefs.current[node.id] = el;
                    }}
                  >
                    <div
                      className={`node-card status-${status} ${selectedNodeId === node.id ? 'selected' : ''}`}
                    >
                      <button
                        type="button"
                        className={`node-card-toggle ${isDragging ? 'dragging' : ''}`.trim()}
                        onClick={() => setSelectedNodeId(node.id)}
                        onPointerDown={(event) => handleNodePointerDown(event, node.id)}
                        onPointerMove={handleNodePointerMove}
                        onPointerUp={handleNodePointerUp}
                        onPointerCancel={handleNodePointerCancel}
                      >
                        <span className="node-label">{node.label}</span>
                        <span className="node-status">{status}</span>
                      </button>
                      {isSeedNode && (
                        <div className="node-card-body">
                          <div className="seed-fields">
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
                          </div>
                          {error && <p className="error-text">{error}</p>}
                          {renderNodePreview('seed', nodeData)}
                          {getNodeTiming(nodeData)}
                        </div>
                      )}
                      {!isSeedNode && (
                        <div className="node-card-body secondary">
                          {renderNodePreview(node.id, nodeData)}
                          {getNodeTiming(nodeData)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {currentRunId && (
            <p className="run-meta">
              Run ID: <code>{currentRunId}</code>
            </p>
          )}
        </section>
      </main>

      <aside className={`panel inspector-panel ${isInspectorOpen ? 'open' : 'collapsed'}`}>
        <div className="inspector-header">
          <h2>Dev Tools</h2>
          <button
            type="button"
            className={`dev-toggle ${isInspectorOpen ? 'active' : ''}`}
            onClick={() => setIsInspectorOpen((prev) => !prev)}
            aria-expanded={isInspectorOpen}
            aria-controls="dev-tools-content"
          >
            Dev
          </button>
        </div>
        {isInspectorOpen && (
          <div id="dev-tools-content" className="dev-content">
            <DevSection
              title="Seed Config"
              isOpen={isSeedConfigOpen}
              onToggle={() => setIsSeedConfigOpen((prev) => !prev)}
            >
              <div className="inline-fields seed-config-fields">
                <label>
                  N ideas
                  <input value={form.n} onChange={handleInputChange('n')} placeholder="DEFAULT_N" />
                </label>
                <label>
                  Top K
                  <input value={form.k} onChange={handleInputChange('k')} placeholder="DEFAULT_K" />
                </label>
              </div>
              <div className="seed-history history">
                <h4>Recent Runs</h4>
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
            </DevSection>

            <DevSection
              title="Inspector"
              isOpen={isInspectorSectionOpen}
              onToggle={() => setIsInspectorSectionOpen((prev) => !prev)}
            >
              {selectedNode ? (
                <div className="inspector">
                  <p>
                    <strong>Status:</strong>{' '}
                    <span className={`status status-${selectedNode.status}`}>{selectedNode.status}</span>
                  </p>
                  <p>
                    <strong>Started:</strong> {formatTimestamp(selectedNode.startedAt)}
                  </p>
                  <p>
                    <strong>Finished:</strong> {formatTimestamp(selectedNode.finishedAt)}
                  </p>
                  {selectedNode.error && <p className="error-text">Error: {selectedNode.error}</p>}
                  <div>
                    <h4>Input</h4>
                    <pre>{serialize(selectedNode.input)}</pre>
                  </div>
                  <div>
                    <h4>Output</h4>
                    <pre>{serialize(selectedNode.output)}</pre>
                  </div>
                </div>
              ) : (
                <p>Select a node to inspect inputs and outputs.</p>
              )}
            </DevSection>

            <DevSection
              title="Output"
              isOpen={isOutputSectionOpen}
              onToggle={() => setIsOutputSectionOpen((prev) => !prev)}
            >
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
            </DevSection>

            {usage && (
              <DevSection
                title="Usage"
                isOpen={isUsageSectionOpen}
                onToggle={() => setIsUsageSectionOpen((prev) => !prev)}
              >
                <pre>{serialize(usage)}</pre>
              </DevSection>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
