import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type CSSProperties,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { ChangeEvent } from 'react';
import {
  fetchGraph,
  fetchRunDetail,
  fetchRuns,
  startRun,
  briefDownloadUrl,
  generateRefinement,
  fetchSeedTemplates,
  generateSeedTemplateSuggestion,
} from './api';
import { useRunStream } from './hooks/useRunStream';
import type {
  Graph,
  NodeStatus,
  PipelineRunState,
  RunDetailResponse,
  RunEvent,
  SeedNodeOutput,
  DivergeNodeOutput,
  PackagedBrief,
  SeedTemplateSummary,
  SeedTemplateKey,
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
  rationale?: string;
  risk?: string;
  sourceIndex: number;
};

type PromotedIdeaNode = {
  id: string;
  label: string;
  idea: IdeaPreview;
  sourceNodeId: string;
  createdAt: string;
};

type RefinementNodeKind = 'ui-flow' | 'capability-breakdown' | 'experience-polish';

interface RefinementFieldDefinition {
  key: string;
  label: string;
  placeholder: string;
  rows?: number;
}

const REFINEMENT_TEMPLATES: Record<RefinementNodeKind, {
  label: string;
  description: string;
  fields: RefinementFieldDefinition[];
}> = {
  'ui-flow': {
    label: 'UI Flow Sketch',
    description:
      'Outline the user journey for this concept so design can translate it into flow diagrams or wireframes.',
    fields: [
      { key: 'entryPoints', label: 'Entry points', placeholder: 'Where does the user encounter this idea first?', rows: 2 },
      {
        key: 'primaryInteractions',
        label: 'Primary interactions',
        placeholder: 'List the key screens, steps, or components the user navigates through.',
        rows: 3,
      },
      { key: 'edgeCases', label: 'Edge cases', placeholder: 'Capture failure states or alternate flows to watch.', rows: 3 },
      {
        key: 'successCriteria',
        label: 'Success criteria',
        placeholder: 'Define what a successful experience looks like for users and the business.',
        rows: 2,
      },
    ],
  },
  'capability-breakdown': {
    label: 'Capability Breakdown',
    description:
      'Identify the technical, operational, and data capabilities needed to bring this idea to life.',
    fields: [
      { key: 'apis', label: 'APIs & services', placeholder: 'List new or existing APIs / services required.', rows: 3 },
      { key: 'dataModels', label: 'Data models', placeholder: 'Which data structures or storage updates are needed?', rows: 3 },
      { key: 'integrations', label: 'Integrations', placeholder: 'Call out internal or third-party integrations.', rows: 3 },
      {
        key: 'dependencies',
        label: 'Dependencies & sequencing',
        placeholder: 'Note cross-team dependencies, sequencing, or blockers.',
        rows: 3,
      },
    ],
  },
  'experience-polish': {
    label: 'Experience Polish Checklist',
    description:
      'Track the experience-level considerations that ensure the idea ships with the right level of quality.',
    fields: [
      {
        key: 'accessibility',
        label: 'Accessibility',
        placeholder: 'Contrast, keyboard paths, semantics, assistive tech behaviours…',
        rows: 3,
      },
      {
        key: 'performance',
        label: 'Performance',
        placeholder: 'Targets, instrumentation, perceived-performance tactics, budgets.',
        rows: 2,
      },
      { key: 'localization', label: 'Localization & voice', placeholder: 'Language, tone, regional content, formatting.', rows: 2 },
      {
        key: 'analytics',
        label: 'Analytics & learning',
        placeholder: 'Event naming, dashboards, cohorts, feedback capture loops.',
        rows: 2,
      },
    ],
  },
};

const REFINEMENT_ORDER: RefinementNodeKind[] = ['ui-flow', 'capability-breakdown', 'experience-polish'];

const PINCH_ZOOM_SENSITIVITY = 0.0025;
const MIN_NODE_SCALE = 0.75;
const MAX_NODE_SCALE = 1.35;
const NODE_SCALE_STEP = 0.1;

type RefinementNode = {
  id: string;
  label: string;
  kind: RefinementNodeKind;
  sourceNodeId: string;
  createdAt: string;
  fields: Record<string, string>;
};

const initialForm: SeedFormState = {
  goal: '',
  audience: '',
  constraints: '',
  n: '',
  k: '',
};

type CanvasNode = {
  id: string;
  label: string;
  type?: 'seed' | 'diverge' | 'idea' | 'refinement';
};

const PIPELINE_CARD_META: Record<string, { order: number; descriptor: string }> = {
  seed: {
    order: 1,
    descriptor: 'Capture the inputs that define this brainstorm run.',
  },
  divergeGenerate: {
    order: 2,
    descriptor: 'Spin up structured concept directions from the seed.',
  },
  convergeSummarize: {
    order: 3,
    descriptor: 'Sift the standout ideas and articulate the takeaways.',
  },
  packageOutput: {
    order: 4,
    descriptor: 'Bundle the selected thinking into a shareable brief.',
  },
};

type NodeHeaderMeta = {
  orderLabel?: string;
  description?: string;
};

function getNodeHeaderMeta(node: CanvasNode): NodeHeaderMeta {
  const meta = PIPELINE_CARD_META[node.id];
  if (meta) {
    return {
      orderLabel: meta.order.toString().padStart(2, '0'),
      description: meta.descriptor,
    };
  }

  if (node.type === 'idea') {
    return {
      description: 'Promoted concept ready for prioritization or packaging.',
    };
  }

  if (node.type === 'refinement') {
    return {
      description: 'Deepen this concept with structured follow-up prompts.',
    };
  }

  return {
    description: 'Pipeline node output from this brainstorm run.',
  };
}

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
  const [packagedBrief, setPackagedBrief] = useState<PackagedBrief | null>(null);
  const [usage, setUsage] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isSeedConfigOpen, setIsSeedConfigOpen] = useState(true);
  const [isInspectorSectionOpen, setIsInspectorSectionOpen] = useState(true);
  const [isOutputSectionOpen, setIsOutputSectionOpen] = useState(true);
  const [isUsageSectionOpen, setIsUsageSectionOpen] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [nodeScale, setNodeScale] = useState(1);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [expandedPreviews, setExpandedPreviews] = useState<Record<string, boolean>>({});
  const [collapsedNodeContent, setCollapsedNodeContent] = useState<Record<string, Record<string, boolean>>>({});
  const [ideaNodesByRun, setIdeaNodesByRun] = useState<Record<string, PromotedIdeaNode[]>>({});
  const [refinementNodesByRun, setRefinementNodesByRun] = useState<Record<string, RefinementNode[]>>({});
  const [seedTemplates, setSeedTemplates] = useState<SeedTemplateSummary[]>([]);
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [isTemplateListLoading, setIsTemplateListLoading] = useState(false);
  const [templateLoading, setTemplateLoading] = useState<Partial<Record<SeedTemplateKey, boolean>>>({});
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [refinementLoading, setRefinementLoading] = useState<Record<string, boolean>>({});
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
  const skipClickRef = useRef(false);
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

  useEffect(() => {
    let isActive = true;
    setIsTemplateListLoading(true);
    setTemplateError(null);
    fetchSeedTemplates()
      .then((templates) => {
        if (!isActive) return;
        setSeedTemplates(templates);
      })
      .catch((err) => {
        if (!isActive) return;
        console.error(err);
        setTemplateError(err instanceof Error ? err.message : 'Failed to load templates.');
      })
      .finally(() => {
        if (isActive) {
          setIsTemplateListLoading(false);
        }
      });
    return () => {
      isActive = false;
    };
  }, []);

  const activeRunKey = currentRunId ?? '__draft__';
  const activeIdeaNodes = ideaNodesByRun[activeRunKey] ?? [];
  const activeRefinementNodes = refinementNodesByRun[activeRunKey] ?? [];

  const ideaNodeById = useMemo(() => {
    if (!activeIdeaNodes.length) return {} as Record<string, PromotedIdeaNode>;
    const map: Record<string, PromotedIdeaNode> = {};
    for (const node of activeIdeaNodes) {
      map[node.id] = node;
    }
    return map;
  }, [activeIdeaNodes]);

  const refinementNodeById = useMemo(() => {
    if (!activeRefinementNodes.length) return {} as Record<string, RefinementNode>;
    const map: Record<string, RefinementNode> = {};
    for (const node of activeRefinementNodes) {
      map[node.id] = node;
    }
    return map;
  }, [activeRefinementNodes]);

  const refinementsByIdea = useMemo(() => {
    if (!activeRefinementNodes.length) return {} as Record<string, RefinementNode[]>;
    const grouped: Record<string, RefinementNode[]> = {};
    for (const node of activeRefinementNodes) {
      if (!grouped[node.sourceNodeId]) {
        grouped[node.sourceNodeId] = [];
      }
      grouped[node.sourceNodeId].push(node);
    }
    return grouped;
  }, [activeRefinementNodes]);

  const createIdeaNodeId = useCallback(
    (index: number) => {
      const runFragment = activeRunKey === '__draft__' ? 'draft' : activeRunKey;
      return `${runFragment}-idea-${index + 1}`;
    },
    [activeRunKey],
  );

  const createRefinementNodeId = useCallback(
    (ideaNodeId: string, kind: RefinementNodeKind, index: number) => {
      const runFragment = activeRunKey === '__draft__' ? 'draft' : activeRunKey;
      return `${runFragment}-${ideaNodeId}-${kind}-${index + 1}`;
    },
    [activeRunKey],
  );

  const handleFocusIdeaNode = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      setExpandedPreviews((prev) => ({
        ...prev,
        [nodeId]: true,
      }));
    },
    [],
  );

  const clearNodeUiState = useCallback((nodeIds: string[]) => {
    if (!nodeIds.length) return;
    setCollapsedNodeContent((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of nodeIds) {
        if (next[id]) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setExpandedPreviews((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of nodeIds) {
        if (id in next) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setRefinementLoading((prev) => {
      if (!Object.keys(prev).length) return prev;
      let changed = false;
      const next: Record<string, boolean> = { ...prev };
      for (const id of nodeIds) {
        const ideaPrefix = `${id}:`;
        for (const key of Object.keys(next)) {
          if (key === id || key.startsWith(ideaPrefix)) {
            delete next[key];
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const handlePromoteIdea = useCallback(
    (idea: IdeaPreview) => {
      if (typeof idea?.sourceIndex !== 'number') return;
      const nodeId = createIdeaNodeId(idea.sourceIndex);
      let createdNodeId: string | null = null;
      setIdeaNodesByRun((prev) => {
        const existingNodes = prev[activeRunKey] ?? [];
        const existingIndex = existingNodes.findIndex((node) => node.idea.sourceIndex === idea.sourceIndex);
        if (existingIndex >= 0) {
          const existingNode = existingNodes[existingIndex];
          const ideaUnchanged =
            existingNode.label === idea.title &&
            existingNode.idea.title === idea.title &&
            existingNode.idea.description === idea.description &&
            existingNode.idea.rationale === idea.rationale &&
            existingNode.idea.risk === idea.risk;
          if (ideaUnchanged) {
            createdNodeId = existingNode.id;
            return prev;
          }
          const nextNodes = [...existingNodes];
          nextNodes[existingIndex] = {
            ...existingNode,
            id: existingNode.id || nodeId,
            label: idea.title,
            idea,
          };
          createdNodeId = nextNodes[existingIndex].id;
          return {
            ...prev,
            [activeRunKey]: nextNodes,
          };
        }

        const nextNodes = [
          ...existingNodes,
          {
            id: nodeId,
            label: idea.title,
            idea,
            sourceNodeId: 'divergeGenerate',
            createdAt: new Date().toISOString(),
          } satisfies PromotedIdeaNode,
        ];
        createdNodeId = nodeId;
        return {
          ...prev,
          [activeRunKey]: nextNodes,
        };
      });
      if (createdNodeId && createdNodeId !== selectedNodeId) {
        handleFocusIdeaNode(createdNodeId);
      }
    },
    [activeRunKey, createIdeaNodeId, handleFocusIdeaNode, selectedNodeId],
  );

  const handleRemoveIdeaNode = useCallback(
    (nodeId: string) => {
      const attachedRefinements = (refinementNodesByRun[activeRunKey] ?? [])
        .filter((node) => node.sourceNodeId === nodeId)
        .map((node) => node.id);
      setIdeaNodesByRun((prev) => {
        const existingNodes = prev[activeRunKey] ?? [];
        if (!existingNodes.length) return prev;
        const nextNodes = existingNodes.filter((node) => node.id !== nodeId);
        if (nextNodes.length === existingNodes.length) return prev;
        return {
          ...prev,
          [activeRunKey]: nextNodes,
        };
      });
      if (attachedRefinements.length) {
        setRefinementNodesByRun((prev) => {
          const runNodes = prev[activeRunKey] ?? [];
          if (!runNodes.length) return prev;
          const nextNodes = runNodes.filter((node) => !attachedRefinements.includes(node.id));
          if (nextNodes.length === runNodes.length) return prev;
          return {
            ...prev,
            [activeRunKey]: nextNodes,
          };
        });
        clearNodeUiState(attachedRefinements);
      }
      setCollapsedNodeContent((prev) => {
        if (!prev[nodeId]) return prev;
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      setExpandedPreviews((prev) => {
        if (!(nodeId in prev)) return prev;
        const next = { ...prev };
        delete next[nodeId];
        return next;
      });
      if (selectedNodeId === nodeId) {
        setSelectedNodeId('divergeGenerate');
      }
      clearNodeUiState([nodeId]);
    },
    [activeRunKey, clearNodeUiState, refinementNodesByRun, selectedNodeId],
  );

  const syncPromotedIdeas = useCallback(
    (runKey: string, ideas: IdeaPreview[]) => {
      const ideaMap = new Map(ideas.map((idea) => [idea.sourceIndex, idea]));
      let nextIdeaNodesRef: PromotedIdeaNode[] | undefined;
      setIdeaNodesByRun((prev) => {
        const existingNodes = prev[runKey];
        if (!existingNodes || existingNodes.length === 0) {
          nextIdeaNodesRef = existingNodes ?? [];
          return prev;
        }
        let changed = false;
        const nextNodes: PromotedIdeaNode[] = [];
        for (const node of existingNodes) {
          const updatedIdea = ideaMap.get(node.idea.sourceIndex);
          if (!updatedIdea) {
            changed = true;
            continue;
          }
          if (
            node.idea.title !== updatedIdea.title ||
            node.idea.description !== updatedIdea.description ||
            node.idea.rationale !== updatedIdea.rationale ||
            node.idea.risk !== updatedIdea.risk ||
            node.label !== updatedIdea.title
          ) {
            nextNodes.push({ ...node, idea: updatedIdea, label: updatedIdea.title });
            changed = true;
          } else {
            nextNodes.push(node);
          }
        }
        if (!changed) {
          nextIdeaNodesRef = existingNodes;
          return prev;
        }
        nextIdeaNodesRef = nextNodes;
        return {
          ...prev,
          [runKey]: nextNodes,
        };
      });
      if (nextIdeaNodesRef) {
        const allowedIds = new Set(nextIdeaNodesRef.map((node) => node.id));
        const removedIds: string[] = [];
        setRefinementNodesByRun((prev) => {
          const runNodes = prev[runKey] ?? [];
          if (!runNodes.length) return prev;
          const filtered = runNodes.filter((node) => {
            const keep = allowedIds.has(node.sourceNodeId);
            if (!keep) {
              removedIds.push(node.id);
            }
            return keep;
          });
          if (filtered.length === runNodes.length) return prev;
          return {
            ...prev,
            [runKey]: filtered,
          };
        });
        if (removedIds.length) {
          clearNodeUiState(removedIds);
        }
      }
    },
    [clearNodeUiState],
  );

  const handleAddRefinementNode = useCallback(
    async (ideaNodeId: string, kind: RefinementNodeKind, sourceIdea?: IdeaPreview) => {
      const template = REFINEMENT_TEMPLATES[kind];
      if (!template) return;

      let ideaNode = ideaNodeById[ideaNodeId];

      if (!ideaNode && sourceIdea) {
        const createdAt = new Date().toISOString();
        const newIdeaNode: PromotedIdeaNode = {
          id: ideaNodeId,
          label: sourceIdea.title,
          idea: sourceIdea,
          sourceNodeId: 'divergeGenerate',
          createdAt,
        };
        let didCreate = false;
        setIdeaNodesByRun((prev) => {
          const runNodes = prev[activeRunKey] ?? [];
          if (runNodes.some((node) => node.id === ideaNodeId)) {
            return prev;
          }
          didCreate = true;
          return {
            ...prev,
            [activeRunKey]: [...runNodes, newIdeaNode],
          };
        });
        if (didCreate) {
          ideaNode = newIdeaNode;
          setExpandedPreviews((prev) => ({
            ...prev,
            [ideaNodeId]: true,
          }));
        }
      }

      if (!ideaNode && !sourceIdea) return;

      const runNodes = refinementNodesByRun[activeRunKey] ?? [];
      const existingForKind = runNodes.find((node) => node.sourceNodeId === ideaNodeId && node.kind === kind);
      if (existingForKind) {
        if (existingForKind.id !== selectedNodeId) {
          handleFocusIdeaNode(existingForKind.id);
        }
        return;
      }
      const ideaPayload = ideaNode?.idea ?? sourceIdea;
      if (!ideaPayload) return;
      const loadingKey = `${ideaNodeId}:${kind}`;
      setRefinementLoading((prev) => ({
        ...prev,
        [loadingKey]: true,
      }));

      try {
        const seedOutput = nodeDetails.seed?.output as SeedNodeOutput | undefined;
        const seedDetails = seedOutput?.details;
        const response = await generateRefinement({
          kind,
          idea: {
            title: ideaPayload.title,
            description: ideaPayload.description,
            rationale: ideaPayload.rationale,
            risk: ideaPayload.risk,
          },
          context:
            seedDetails ?? {
              goal: form.goal.trim() || undefined,
              audience: form.audience.trim() || undefined,
              constraints: form.constraints.trim() || undefined,
            },
        });

        let newNodeId = '';
        setRefinementNodesByRun((prev) => {
          const currentRunNodes = prev[activeRunKey] ?? [];
          const siblings = currentRunNodes.filter((node) => node.sourceNodeId === ideaNodeId && node.kind === kind);
          newNodeId = createRefinementNodeId(ideaNodeId, kind, siblings.length);
          const nextNode: RefinementNode = {
            id: newNodeId,
            label: template.label,
            kind,
            sourceNodeId: ideaNodeId,
            createdAt: new Date().toISOString(),
            fields: response.fields,
          };
          return {
            ...prev,
            [activeRunKey]: [...currentRunNodes, nextNode],
          };
        });

        if (newNodeId && newNodeId !== selectedNodeId) {
          handleFocusIdeaNode(newNodeId);
        }
        setExpandedPreviews((prev) => ({
          ...prev,
          [newNodeId]: true,
        }));
      } catch (error) {
        console.error('Failed to generate refinement node', error);
      } finally {
        setRefinementLoading((prev) => {
          const next = { ...prev };
          delete next[loadingKey];
          return next;
        });
      }
    },
    [
      activeRunKey,
      createRefinementNodeId,
      form.audience,
      form.constraints,
      form.goal,
      handleFocusIdeaNode,
      ideaNodeById,
      nodeDetails,
      refinementNodesByRun,
      selectedNodeId,
    ],
  );

  const handleUpdateRefinementField = useCallback(
    (nodeId: string, fieldKey: string, value: string) => {
      setRefinementNodesByRun((prev) => {
        const runNodes = prev[activeRunKey] ?? [];
        const index = runNodes.findIndex((node) => node.id === nodeId);
        if (index === -1) return prev;
        const node = runNodes[index];
        if (node.fields[fieldKey] === value) return prev;
        const nextNodes = [...runNodes];
        nextNodes[index] = {
          ...node,
          fields: {
            ...node.fields,
            [fieldKey]: value,
          },
        };
        return {
          ...prev,
          [activeRunKey]: nextNodes,
        };
      });
    },
    [activeRunKey],
  );

  const handleRemoveRefinementNode = useCallback(
    (nodeId: string) => {
      const parentId = refinementNodeById[nodeId]?.sourceNodeId;
      setRefinementNodesByRun((prev) => {
        const runNodes = prev[activeRunKey] ?? [];
        if (!runNodes.length) return prev;
        const nextNodes = runNodes.filter((node) => node.id !== nodeId);
        if (nextNodes.length === runNodes.length) return prev;
        return {
          ...prev,
          [activeRunKey]: nextNodes,
        };
      });
      clearNodeUiState([nodeId]);
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(parentId ?? 'divergeGenerate');
      }
    },
    [activeRunKey, clearNodeUiState, refinementNodeById, selectedNodeId],
  );

  const ideaNodeDetails = useMemo(() => {
    if (!activeIdeaNodes.length) return {} as Record<string, NodeData>;
    const map: Record<string, NodeData> = {};
    for (const node of activeIdeaNodes) {
      const structuredOutput = {
        type: 'idea-node',
        id: node.id,
        label: node.label,
        sourceNodeId: node.sourceNodeId,
        idea: node.idea,
      } as const;
      map[node.id] = {
        status: 'completed',
        output: structuredOutput,
        startedAt: node.createdAt,
        finishedAt: node.createdAt,
      };
    }
    return map;
  }, [activeIdeaNodes]);

  const refinementNodeDetails = useMemo(() => {
    if (!activeRefinementNodes.length) return {} as Record<string, NodeData>;
    const map: Record<string, NodeData> = {};
    for (const node of activeRefinementNodes) {
      const structuredOutput = {
        type: 'refinement-node',
        id: node.id,
        label: node.label,
        kind: node.kind,
        sourceNodeId: node.sourceNodeId,
        fields: node.fields,
      } as const;
      map[node.id] = {
        status: 'completed',
        output: structuredOutput,
        startedAt: node.createdAt,
        finishedAt: node.createdAt,
      };
    }
    return map;
  }, [activeRefinementNodes]);

  const combinedNodeDetails = useMemo(() => {
    if (!Object.keys(ideaNodeDetails).length && !Object.keys(refinementNodeDetails).length) {
      return nodeDetails;
    }
    return { ...nodeDetails, ...ideaNodeDetails, ...refinementNodeDetails };
  }, [ideaNodeDetails, nodeDetails, refinementNodeDetails]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return combinedNodeDetails[selectedNodeId] || null;
  }, [combinedNodeDetails, selectedNodeId]);

  const baseGraphNodes = graph?.nodes ?? [];
  const ideaGraphNodes = useMemo(
    () =>
      activeIdeaNodes.map((node) => ({
        id: node.id,
        label: node.label,
        type: 'idea' as const,
      })),
    [activeIdeaNodes],
  );

  const refinementGraphNodes = useMemo(
    () =>
      activeRefinementNodes.map((node) => ({
        id: node.id,
        label: node.label,
        type: 'refinement' as const,
      })),
    [activeRefinementNodes],
  );

  const graphNodes = useMemo<CanvasNode[]>(
    () => [...baseGraphNodes, ...ideaGraphNodes, ...refinementGraphNodes] as CanvasNode[],
    [baseGraphNodes, ideaGraphNodes, refinementGraphNodes],
  );

  const graphNodeById = useMemo(() => {
    const map: Record<string, Graph['nodes'][number]> = {};
    for (const node of graphNodes) {
      map[node.id] = node;
    }
    return map;
  }, [graphNodes]);

  const baseGraphEdges = graph?.edges ?? [];
  const ideaGraphEdges = useMemo(
    () =>
      activeIdeaNodes.map((node) => ({
        source: node.sourceNodeId,
        target: node.id,
      })),
    [activeIdeaNodes],
  );

  const refinementGraphEdges = useMemo(
    () =>
      activeRefinementNodes.map((node) => ({
        source: node.sourceNodeId,
        target: node.id,
      })),
    [activeRefinementNodes],
  );

  const graphEdges = useMemo(
    () => [...baseGraphEdges, ...ideaGraphEdges, ...refinementGraphEdges],
    [baseGraphEdges, ideaGraphEdges, refinementGraphEdges],
  );

  useEffect(() => {
    if (!graphNodes.length) return;

    const pipelineBaseNodes = graphNodes
      .filter((node) => node.type !== 'idea' && node.type !== 'refinement')
      .sort((a, b) => {
        const orderA = PIPELINE_CARD_META[a.id]?.order ?? Number.MAX_SAFE_INTEGER;
        const orderB = PIPELINE_CARD_META[b.id]?.order ?? Number.MAX_SAFE_INTEGER;
        if (orderA === orderB) {
          return a.id.localeCompare(b.id);
        }
        return orderA - orderB;
      });

    const pipelineIndexById: Record<string, number> = {};
    pipelineBaseNodes.forEach((node, index) => {
      pipelineIndexById[node.id] = index;
    });

    const totalIdeaNodes = activeIdeaNodes.length;
    const ideaColumns = totalIdeaNodes > 0 ? Math.max(1, Math.ceil(Math.sqrt(totalIdeaNodes))) : 1;

    const refinementColumnsByIdea: Record<string, number> = {};
    for (const [ideaId, list] of Object.entries(refinementsByIdea) as [string, RefinementNode[]][]) {
      const count = list.length;
      refinementColumnsByIdea[ideaId] = count > 0 ? Math.max(1, Math.ceil(Math.sqrt(count))) : 1;
    }

    setNodePositions((prev) => {
      let changed = false;
      const next: Record<string, { x: number; y: number }> = { ...prev };
      const ideaIndexById: Record<string, number> = {};
      activeIdeaNodes.forEach((ideaNode, index) => {
        ideaIndexById[ideaNode.id] = index;
      });
      const refinementIndexById: Record<string, number> = {};
      for (const refinementList of Object.values(refinementsByIdea) as RefinementNode[][]) {
        refinementList.forEach((refinementNode, index) => {
          refinementIndexById[refinementNode.id] = index;
        });
      }

      const PIPELINE_HORIZONTAL_SPACING = 420;
      const PIPELINE_BASE_Y = 0;
      const IDEA_BASE_OFFSET_X = 360;
      const IDEA_HORIZONTAL_SPACING = 360;
      const IDEA_VERTICAL_SPACING = 320;
      const REFINEMENT_BASE_OFFSET_X = 320;
      const REFINEMENT_HORIZONTAL_SPACING = 320;
      const REFINEMENT_VERTICAL_SPACING = 280;

      for (const node of graphNodes) {
        if (next[node.id]) continue;

        if (node.type === 'idea') {
          const divergePosition = next['divergeGenerate'] ?? prev['divergeGenerate'] ?? { x: 0, y: 0 };
          const ideaIndex = ideaIndexById[node.id] ?? 0;
          const column = ideaColumns > 0 ? ideaIndex % ideaColumns : 0;
          const row = ideaColumns > 0 ? Math.floor(ideaIndex / ideaColumns) : 0;
          next[node.id] = {
            x: divergePosition.x + IDEA_BASE_OFFSET_X + column * IDEA_HORIZONTAL_SPACING,
            y: divergePosition.y + row * IDEA_VERTICAL_SPACING,
          };
        } else if (node.type === 'refinement') {
          const refinementMeta = refinementNodeById[node.id];
          const parentId = refinementMeta?.sourceNodeId;
          const parentPosition = parentId
            ? next[parentId] ?? prev[parentId] ?? { x: 0, y: 0 }
            : { x: 0, y: 0 };
          const columns = parentId ? refinementColumnsByIdea[parentId] ?? 1 : 1;
          const refinementIndex = refinementIndexById[node.id] ?? 0;
          const column = columns > 0 ? refinementIndex % columns : 0;
          const row = columns > 0 ? Math.floor(refinementIndex / columns) : 0;
          next[node.id] = {
            x: parentPosition.x + REFINEMENT_BASE_OFFSET_X + column * REFINEMENT_HORIZONTAL_SPACING,
            y: parentPosition.y + row * REFINEMENT_VERTICAL_SPACING,
          };
        } else {
          const stageIndex = pipelineIndexById[node.id] ?? 0;
          next[node.id] = {
            x: stageIndex * PIPELINE_HORIZONTAL_SPACING,
            y: PIPELINE_BASE_Y,
          };
        }
        changed = true;
      }

      for (const existingId of Object.keys(next)) {
        if (!graphNodes.some((node) => node.id === existingId)) {
          delete next[existingId];
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [activeIdeaNodes, activeRefinementNodes, graphNodes, refinementNodeById, refinementsByIdea]);

  const measureEdges = useCallback(() => {
    const canvasEl = canvasContentRef.current;
    if (!canvasEl || !graphEdges.length) {
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

    for (const edge of graphEdges) {
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
      const sourceStatus = combinedNodeDetails[edge.source]?.status;
      const targetStatus = combinedNodeDetails[edge.target]?.status;
      const status: NodeStatus = sourceStatus || targetStatus || 'pending';
      const sourceLabel = graphNodeById[edge.source]?.label || edge.source;
      const targetLabel = graphNodeById[edge.target]?.label || edge.target;

      const sourceOutput = combinedNodeDetails[edge.source]?.output;
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
  }, [combinedNodeDetails, graphEdges, graphNodeById]);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => {
      measureEdges();
    });
    return () => cancelAnimationFrame(raf);
  }, [measureEdges, graphNodes, nodePositions, zoom, nodeScale]);

  useEffect(() => {
    const handleResize = () => measureEdges();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
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
    skipClickRef.current = false;
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

    const scaleFactor = zoom * nodeScale || 1;
    const dx = (event.clientX - state.pointerStartX) / scaleFactor;
    const dy = (event.clientY - state.pointerStartY) / scaleFactor;

    if (!state.wasDragging) {
      const distance = Math.hypot(dx, dy);
      if (distance < 3) return;
      state.wasDragging = true;
      skipClickRef.current = true;
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
    if (state.wasDragging) {
      skipClickRef.current = true;
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

  const handleNodeCardClick = (nodeId: string) => {
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }
    setSelectedNodeId(nodeId);
  };

  const handleInputChange = (field: keyof SeedFormState) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const resetRunState = (
    seedPayload: { goal: string; audience: string; constraints: string; n?: number; k?: number },
    runId?: string,
  ) => {
    const seedNode: NodeData = { status: 'pending', input: seedPayload, output: null };
    const divergeNode: NodeData = { status: 'pending', input: { n: seedPayload.n, seed: seedPayload }, output: null };
    setNodeDetails({
      seed: seedNode,
      divergeGenerate: divergeNode,
    });
    setBrief('');
    setPackagedBrief(null);
    setUsage(null);
    setSelectedNodeId('seed');
    setExpandedPreviews({});
    setCollapsedNodeContent({});
    const runKey = runId ?? '__draft__';
    setIdeaNodesByRun((prev) => ({
      ...prev,
      [runKey]: [],
    }));
    setRefinementNodesByRun((prev) => ({
      ...prev,
      [runKey]: [],
    }));
  };

  const handleApplySeedTemplate = async (templateKey: SeedTemplateKey) => {
    setTemplateError(null);
    setTemplateLoading((prev) => ({
      ...prev,
      [templateKey]: true,
    }));
    try {
      const suggestion = await generateSeedTemplateSuggestion(templateKey);
      setForm((prev) => ({
        ...prev,
        goal: suggestion.goal,
        audience: suggestion.audience,
        constraints: suggestion.constraints,
      }));
      setIsTemplateMenuOpen(false);
      setError(null);
    } catch (err) {
      console.error(err);
      setTemplateError(err instanceof Error ? err.message : 'Failed to generate template.');
    } finally {
      setTemplateLoading((prev) => {
        if (!prev[templateKey]) return prev;
        const next = { ...prev };
        delete next[templateKey];
        return next;
      });
    }
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
      resetRunState(payload, response.runId);
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
    setIdeaNodesByRun((prev) => {
      if (run.id in prev) return prev;
      return {
        ...prev,
        [run.id]: [],
      };
    });
    setRefinementNodesByRun((prev) => {
      if (run.id in prev) return prev;
      return {
        ...prev,
        [run.id]: [],
      };
    });
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
    ideasValue.forEach((idea, index) => {
      if (!idea || typeof idea !== 'object') return;
      const { title, description, rationale, risk } = idea as Record<string, unknown>;
      if (typeof title !== 'string') return;
      const cleanedTitle = tidyText(title);
      if (!cleanedTitle) return;
      const cleanedDescription =
        typeof description === 'string' && description.trim() ? tidyText(description) : undefined;
      const cleanedRationale =
        typeof rationale === 'string' && rationale.trim() ? tidyText(rationale) : undefined;
      const cleanedRisk = typeof risk === 'string' && risk.trim() ? tidyText(risk) : undefined;
      sanitized.push({
        title: cleanedTitle,
        sourceIndex: index,
        ...(cleanedDescription ? { description: cleanedDescription } : {}),
        ...(cleanedRationale ? { rationale: cleanedRationale } : {}),
        ...(cleanedRisk ? { risk: cleanedRisk } : {}),
      });
    });
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

  const packagedSections = useMemo(() => {
    if (!packagedBrief) return [] as Array<{ title: string; body: string }>;
    const normalized = (packagedBrief.sections ?? [])
      .map((section) => ({
        title: tidyText(section.title || ''),
        body: tidyText(section.body || ''),
      }))
      .filter((section) => section.body.length > 0);
    if (normalized.length > 0) {
      return normalized;
    }
    const fallback = packagedBrief.brief
      .split(/\n{2,}/)
      .map((block) => tidyText(block))
      .filter((block) => block.length > 0)
      .map((body, index) => ({ title: `Section ${index + 1}`, body }));
    return fallback;
  }, [packagedBrief, tidyText]);

  const packagedMetaLabel = useMemo(() => {
    if (!packagedBrief) return '';
    const parts: string[] = [];
    const { metadata, brief: packagedBriefText } = packagedBrief;
    if (metadata) {
      if (typeof metadata.selectedCount === 'number') {
        parts.push(`${metadata.selectedCount} selected`);
      }
      if (typeof metadata.totalGenerated === 'number') {
        parts.push(`${metadata.totalGenerated} generated`);
      }
    }
    if (typeof packagedBriefText === 'string' && packagedBriefText.trim()) {
      const wordCount = packagedBriefText.trim().split(/\s+/).length;
      parts.push(`${wordCount} words`);
    }
    return parts.join(' • ');
  }, [packagedBrief]);

  const packagedSummary = useMemo(() => {
    if (!packagedBrief) return '';
    return tidyText(packagedBrief.summary);
  }, [packagedBrief, tidyText]);

  const applyRunDetail = useCallback(
    (detail: RunDetailResponse) => {
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

      const runKey = detail.state.id ?? '__draft__';
      setIdeaNodesByRun((prev) => {
        if (runKey in prev) return prev;
        return {
          ...prev,
          [runKey]: [],
        };
      });
      setRefinementNodesByRun((prev) => {
        if (runKey in prev) return prev;
        return {
          ...prev,
          [runKey]: [],
        };
      });

      const divergeOutput = merged.divergeGenerate?.output;
      if (divergeOutput) {
        const divergeIdeas = extractIdeas(divergeOutput);
        syncPromotedIdeas(runKey, divergeIdeas);
      }

      if (detail.brief) {
        setBrief(detail.brief);
      } else if (detail.packagedBrief?.brief) {
        setBrief(detail.packagedBrief.brief);
      }
      if (detail.usage) setUsage(detail.usage);
      const packaged = detail.packagedBrief ?? detail.state.packagedBrief;
      setPackagedBrief(packaged ?? null);
      setCollapsedNodeContent({});
      setExpandedPreviews({});
    },
    [extractIdeas, syncPromotedIdeas],
  );

  const refreshRunDetail = useCallback(
    async (runId: string) => {
      try {
        const detail = await fetchRunDetail(runId);
        applyRunDetail(detail);
        const updatedRuns = await fetchRuns();
        setRuns(updatedRuns);
      } catch (err) {
        console.error('Failed to load run detail', err);
      }
    },
    [applyRunDetail],
  );

  const handleRunEvent = useCallback(
    (event: RunEvent) => {
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
        setCollapsedNodeContent((prev) => {
          if (!prev[event.nodeId]) return prev;
          const next = { ...prev };
          delete next[event.nodeId];
          return next;
        });
        if (event.nodeId === 'divergeGenerate') {
          const ideas = extractIdeas(event.payload);
          const runKey = event.runId ?? activeRunKey;
          syncPromotedIdeas(runKey, ideas);
        }
      } else if (event.type === 'packaged-brief') {
        setPackagedBrief(event.payload);
        if (event.payload?.brief) {
          setBrief(event.payload.brief);
        }
        setExpandedPreviews((prev) => ({
          ...prev,
          packagedBrief: false,
        }));
        setCollapsedNodeContent((prev) => {
          if (!prev.packagedBrief) return prev;
          const next = { ...prev };
          delete next.packagedBrief;
          return next;
        });
      } else if (event.type === 'run-status') {
        setRunStatus(event.status);
        if (event.status === 'completed' || event.status === 'failed') {
          refreshRunDetail(event.runId);
        }
      }
    },
    [activeRunKey, extractIdeas, refreshRunDetail, syncPromotedIdeas],
  );

  useRunStream(runStatus === 'running' ? currentRunId : null, handleRunEvent);

  const togglePreviewExpansion = useCallback((nodeId: string) => {
    setExpandedPreviews((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }));
  }, []);

  const toggleNodeContent = useCallback((nodeId: string, contentId: string) => {
    setCollapsedNodeContent((prev) => {
      const nodeState = prev[nodeId] || {};
      const nextNodeState = {
        ...nodeState,
        [contentId]: !nodeState[contentId],
      };
      return {
        ...prev,
        [nodeId]: nextNodeState,
      };
    });
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
      const graphNode = graphNodeById[nodeId];

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

      if (graphNode?.type === 'idea') {
        const promoted = ideaNodeById[nodeId];
        if (!promoted) {
          return (
            <div className="node-preview muted">
              <p className="node-card-info muted">Idea details unavailable.</p>
            </div>
          );
        }
        const { idea } = promoted;
        const description = idea.description ?? null;
        const rationale = idea.rationale ?? null;
        const risk = idea.risk ?? null;
        const summaryLabel = `Idea #${idea.sourceIndex + 1}`;
        const ideaRefinements = refinementsByIdea[nodeId] ?? [];
        const refinementKindsPresent = new Set(ideaRefinements.map((refinement) => refinement.kind));

        return (
          <div className="node-preview idea-node-preview">
            <div className="node-preview-header">
              <span className="node-preview-title">{idea.title}</span>
              <span className="node-preview-meta">{summaryLabel}</span>
            </div>
            <div className="idea-card-body" role="group" aria-label={`Details for ${idea.title}`}>
              {description && <p>{description}</p>}
              {rationale && (
                <p className="idea-card-meta">
                  <strong>Rationale:</strong> {rationale}
                </p>
              )}
              {risk && <p className="idea-card-risk">Risk: {risk}</p>}
              {!description && !rationale && !risk && (
                <p className="node-card-info muted">No additional details captured for this idea.</p>
              )}
            </div>
            <div className="idea-card-actions">
              <button
                type="button"
                className="idea-card-action secondary"
                onClick={() => handleRemoveIdeaNode(nodeId)}
              >
                Remove node
              </button>
              <button
                type="button"
                className="idea-card-action"
                onClick={() => handleFocusIdeaNode('divergeGenerate')}
              >
                View in Diverge node
              </button>
            </div>
            <div className="idea-card-actions tertiary">
              {REFINEMENT_ORDER.map((kind) => {
                const template = REFINEMENT_TEMPLATES[kind];
                const existing = ideaRefinements.find((refinement) => refinement.kind === kind);
                const hasKind = refinementKindsPresent.has(kind);
                const refinementKey = `${nodeId}:${kind}`;
                const isLoading = Boolean(refinementLoading[refinementKey]);
                const label = isLoading
                  ? 'Generating…'
                  : hasKind
                  ? `View ${template.label}`
                  : `Add ${template.label}`;
                const handleAction = hasKind
                  ? () => existing && handleFocusIdeaNode(existing.id)
                  : () => void handleAddRefinementNode(nodeId, kind);
                return (
                  <button
                    key={`${nodeId}-${kind}`}
                    type="button"
                    className={`idea-card-action ${hasKind ? '' : 'outline'}`.trim()}
                    onClick={handleAction}
                    disabled={isLoading}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {ideaRefinements.length > 0 && (
              <ul className="refinement-summary-list">
                {ideaRefinements.map((refinement) => (
                  <li key={refinement.id}>
                    <button
                      type="button"
                      className="refinement-summary-button"
                      onClick={() => handleFocusIdeaNode(refinement.id)}
                    >
                      {refinement.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }

      if (graphNode?.type === 'refinement') {
        const refinement = refinementNodeById[nodeId];
        if (!refinement) {
          return (
            <div className="node-preview muted">
              <p className="node-card-info muted">Refinement details unavailable.</p>
            </div>
          );
        }
        const template = REFINEMENT_TEMPLATES[refinement.kind];
        const parentIdea = ideaNodeById[refinement.sourceNodeId];
        return (
          <div className="node-preview refinement-node-preview">
            <div className="node-preview-header">
              <span className="node-preview-title">{template.label}</span>
              <span className="node-preview-meta">{parentIdea?.label ?? 'Idea node'}</span>
            </div>
            <p className="node-card-info refinement-description">{template.description}</p>
            <form className="refinement-form" onSubmit={(event) => event.preventDefault()}>
              {template.fields.map((field) => (
                <label key={field.key}>
                  <span>{field.label}</span>
                  <textarea
                    value={refinement.fields[field.key] ?? ''}
                    onChange={(event) => handleUpdateRefinementField(nodeId, field.key, event.target.value)}
                    placeholder={field.placeholder}
                    rows={field.rows ?? 3}
                  />
                </label>
              ))}
            </form>
            <div className="idea-card-actions">
              <button
                type="button"
                className="idea-card-action secondary"
                onClick={() => handleRemoveRefinementNode(nodeId)}
              >
                Remove refinement
              </button>
              <button
                type="button"
                className="idea-card-action"
                onClick={() => handleFocusIdeaNode(refinement.sourceNodeId)}
              >
                View parent idea
              </button>
            </div>
          </div>
        );
      }

      if (nodeId === 'divergeGenerate') {
        const divergeOutput = node.output as DivergeNodeOutput | undefined;
        const ideas = extractIdeas(node.output);
        const overview = divergeOutput?.overview;
        const summary = divergeOutput?.summary ? tidyText(divergeOutput.summary) : '';
        if (!ideas.length) {
          return (
            <div className="node-preview muted">
              <p className="node-card-info muted">{summary || 'No ideas captured yet.'}</p>
            </div>
          );
        }
        const metaParts: string[] = [`${ideas.length} idea${ideas.length === 1 ? '' : 's'}`];
        if (overview?.model) {
          metaParts.push(overview.model);
        }
        const metaLabel = metaParts.join(' • ');
        const MAX_VISIBLE = 5;
        const visibleIdeas = isExpanded ? ideas : ideas.slice(0, MAX_VISIBLE);
        const hiddenCount = ideas.length - visibleIdeas.length;

        return (
          <div className="node-preview">
            <div className="node-preview-header">
              <span className="node-preview-title">{divergeOutput?.title ?? 'Ideas'}</span>
              <span className="node-preview-meta">{metaLabel}</span>
            </div>
            {summary && <p className="node-card-info">{summary}</p>}
            <div className="idea-card-list" aria-label="Generated ideas">
              {visibleIdeas.map((idea) => {
                const sourceIndex = typeof idea.sourceIndex === 'number' ? idea.sourceIndex : 0;
                const ideaKey = `idea-${sourceIndex}`;
                const contentId = `${nodeId}-${ideaKey}`;
                const isIdeaCollapsed = collapsedNodeContent[nodeId]?.[ideaKey] ?? false;
                const handleIdeaToggle = () => toggleNodeContent(nodeId, ideaKey);
                const description = idea.description
                  ? isExpanded
                    ? idea.description
                    : truncateText(idea.description, 120)
                  : null;
                const rationale = idea.rationale
                  ? isExpanded
                    ? idea.rationale
                    : truncateText(idea.rationale, 120)
                  : null;
                const risk = idea.risk
                  ? isExpanded
                    ? idea.risk
                    : truncateText(idea.risk, 110)
                  : null;
                const collapsedPreview = idea.description
                  ? truncateText(idea.description, 110)
                  : idea.rationale
                  ? truncateText(idea.rationale, 110)
                  : idea.risk
                  ? truncateText(idea.risk, 110)
                  : null;
                const promotedNode = activeIdeaNodes.find((node) => node.idea.sourceIndex === sourceIndex);
                const promotedNodeId = promotedNode?.id ?? createIdeaNodeId(sourceIndex);
                const isPromoted = Boolean(promotedNode);
                const promoteIdea = () => handlePromoteIdea(idea);
                const focusIdea = () => handleFocusIdeaNode(promotedNodeId);
                const removeIdea = () => handleRemoveIdeaNode(promotedNodeId);
                const ideaRefinements = refinementsByIdea[promotedNodeId] ?? [];
                const refinementKindsPresent = new Set(ideaRefinements.map((refinement) => refinement.kind));
                return (
                  <article
                    key={promotedNodeId}
                    className={`idea-card ${isIdeaCollapsed ? 'collapsed' : ''} ${
                      isPromoted ? 'promoted' : ''
                    }`.trim()}
                  >
                    <button
                      type="button"
                      className="idea-card-toggle"
                      onClick={handleIdeaToggle}
                      aria-expanded={!isIdeaCollapsed}
                      aria-controls={contentId}
                    >
                      <span className="idea-card-title">{idea.title}</span>
                      {isPromoted && <span className="idea-card-chip">Node created</span>}
                      <span className="collapse-indicator idea-collapse-indicator" aria-hidden="true">
                        {isIdeaCollapsed ? '+' : '−'}
                      </span>
                    </button>
                    {collapsedPreview && isIdeaCollapsed && (
                      <p className="idea-card-preview">{collapsedPreview}</p>
                    )}
                    <div className="idea-card-body" id={contentId} hidden={isIdeaCollapsed}>
                      {description && <p>{description}</p>}
                      {rationale && (
                        <p className="idea-card-meta">
                          <strong>Rationale:</strong> {rationale}
                        </p>
                      )}
                      {risk && <p className="idea-card-risk">Risk: {risk}</p>}
                    </div>
                    <div className="idea-card-actions">
                      {!isPromoted && (
                        <button type="button" className="idea-card-action" onClick={promoteIdea}>
                          Pull into node
                        </button>
                      )}
                      {isPromoted && (
                        <>
                          <button type="button" className="idea-card-action" onClick={focusIdea}>
                            View node
                          </button>
                          <button
                            type="button"
                            className="idea-card-action secondary"
                            onClick={removeIdea}
                          >
                            Remove node
                          </button>
                        </>
                      )}
                    </div>
                    {isPromoted && (
                      <div className="idea-card-actions tertiary">
                        {REFINEMENT_ORDER.map((kind) => {
                          const template = REFINEMENT_TEMPLATES[kind];
                          const existing = ideaRefinements.find((refinement) => refinement.kind === kind);
                          const hasKind = refinementKindsPresent.has(kind);
                          const refinementKey = `${promotedNodeId}:${kind}`;
                          const isLoading = Boolean(refinementLoading[refinementKey]);
                          const label = isLoading
                            ? 'Generating…'
                            : hasKind
                            ? `View ${template.label}`
                            : `Add ${template.label}`;
                          const handleAction = hasKind
                            ? () => existing && handleFocusIdeaNode(existing.id)
                            : () =>
                                void handleAddRefinementNode(
                                  promotedNodeId,
                                  kind,
                                  promotedNode?.idea ?? idea,
                                );
                          return (
                            <button
                              key={`${promotedNodeId}-${kind}`}
                              type="button"
                              className={`idea-card-action ${hasKind ? '' : 'outline'}`.trim()}
                              onClick={handleAction}
                              disabled={isLoading}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    )}
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

      if (nodeId === 'seed') {
        const seedOutput = node.output as SeedNodeOutput | undefined;
        const summary = seedOutput?.summary ? tidyText(seedOutput.summary) : '';
        const parameters = seedOutput?.parameters;
        const metaParts: string[] = [];
        if (parameters) {
          if (typeof parameters.requestedIdeas === 'number' && parameters.requestedIdeas > 0) {
            metaParts.push(`${parameters.requestedIdeas} idea${parameters.requestedIdeas === 1 ? '' : 's'}`);
          }
          if (typeof parameters.topK === 'number' && parameters.topK > 0) {
            metaParts.push(`top ${parameters.topK}`);
          }
        }
        const metaLabel = metaParts.join(' • ');
        return (
          <div className="node-preview">
            <div className="node-preview-header">
              <span className="node-preview-title">{seedOutput?.title ?? 'Seed'}</span>
              {metaLabel && <span className="node-preview-meta">{metaLabel}</span>}
            </div>
            {summary ? (
              <p className="node-card-info">{summary}</p>
            ) : (
              <p className="node-card-info muted">Edit goal, audience, and constraints in the fields above.</p>
            )}
          </div>
        );
      }

      return null;
    },
    [
      expandedPreviews,
      collapsedNodeContent,
      activeIdeaNodes,
      createIdeaNodeId,
      extractBrief,
      extractIdeas,
      formatBriefHeading,
      graphNodeById,
      handleAddRefinementNode,
      handleFocusIdeaNode,
      handlePromoteIdea,
      handleRemoveIdeaNode,
      handleRemoveRefinementNode,
      handleUpdateRefinementField,
      ideaNodeById,
      refinementNodeById,
      refinementsByIdea,
      tidyText,
      toggleNodeContent,
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

  const handleIncreaseNodeScale = () => {
    setNodeScale((prev) => Math.min(MAX_NODE_SCALE, Number((prev + NODE_SCALE_STEP).toFixed(2))));
  };

  const handleDecreaseNodeScale = () => {
    setNodeScale((prev) => Math.max(MIN_NODE_SCALE, Number((prev - NODE_SCALE_STEP).toFixed(2))));
  };

  const handleResetNodeScale = () => {
    setNodeScale(1);
  };

  const handleCanvasWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const { deltaY } = event;
      if (Number.isNaN(deltaY) || deltaY === 0) return;
      setZoom((prev) => {
        const factor = Math.exp(-deltaY * PINCH_ZOOM_SENSITIVITY);
        const next = Number((prev * factor).toFixed(2));
        return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
      });
    },
    [MAX_ZOOM, MIN_ZOOM],
  );

  const canvasStyle = useMemo(() => {
    const style: CSSProperties = {
      transform: `scale(${zoom})`,
      transformOrigin: 'top left',
    };
    (style as CSSProperties & Record<string, string | number>)["--node-scale"] = nodeScale.toFixed(2);
    return style;
  }, [nodeScale, zoom]);

  const canZoomIn = zoom < MAX_ZOOM;
  const canZoomOut = zoom > MIN_ZOOM;
  const showReset = zoom !== 1;
  const canScaleUp = nodeScale < MAX_NODE_SCALE - 1e-3;
  const canScaleDown = nodeScale > MIN_NODE_SCALE + 1e-3;
  const showScaleReset = Math.abs(nodeScale - 1) > 0.01;
  const nodeScaleLabel = Math.round(nodeScale * 100);

  const appShellClassName = ['app-shell', isInspectorOpen ? 'dev-open' : '']
    .filter(Boolean)
    .join(' ');

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
              <div className="node-size-controls" role="group" aria-label="Node size">
                <button
                  type="button"
                  className="zoom-button"
                  onClick={handleDecreaseNodeScale}
                  disabled={!canScaleDown}
                  aria-label="Decrease node size"
                >
                  A−
                </button>
                <span className="zoom-level" aria-live="polite">
                  {nodeScaleLabel}%
                </span>
                <button
                  type="button"
                  className="zoom-button"
                  onClick={handleIncreaseNodeScale}
                  disabled={!canScaleUp}
                  aria-label="Increase node size"
                >
                  A+
                </button>
                {showScaleReset && (
                  <button type="button" className="zoom-reset" onClick={handleResetNodeScale}>
                    Reset
                  </button>
                )}
              </div>
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
          <div className="canvas" onWheel={handleCanvasWheel}>
            <div
              className="canvas-content"
              ref={canvasContentRef}
              style={canvasStyle}
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
                const nodeData = combinedNodeDetails[node.id];
                const status = nodeData?.status ?? 'pending';
                const isSeedNode = node.id === 'seed';
                const position = nodePositions[node.id] ?? { x: 0, y: 0 };
                const isDragging = draggingNodeId === node.id;
                const headerMeta = getNodeHeaderMeta(node);
                const statusLabel = `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
                return (
                  <div
                    className={`canvas-item ${isDragging ? 'dragging' : ''}`}
                    key={node.id}
                    style={{ transform: `translate(${position.x * nodeScale}px, ${position.y * nodeScale}px)` }}
                  >
                    <div
                      className="node-card-wrapper"
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
                        onClick={() => handleNodeCardClick(node.id)}
                        onPointerDown={(event) => handleNodePointerDown(event, node.id)}
                        onPointerMove={handleNodePointerMove}
                        onPointerUp={handleNodePointerUp}
                        onPointerCancel={handleNodePointerCancel}
                      >
                        <span className="node-toggle-content">
                          <span className="node-header-line">
                            {headerMeta.orderLabel && (
                              <span className="node-sequence-chip">{headerMeta.orderLabel}</span>
                            )}
                            <span className="node-label">{node.label}</span>
                          </span>
                          <span className="node-subheader-line">
                            {headerMeta.description && (
                              <span className="node-descriptor">{headerMeta.description}</span>
                            )}
                            <span className={`node-status-pill status-${status}`}>{statusLabel}</span>
                          </span>
                        </span>
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
          <div className="inspector-actions">
            <button
              type="button"
              className={`template-toggle ${isTemplateMenuOpen ? 'active' : ''}`}
              onClick={() =>
                setIsTemplateMenuOpen((prev) => {
                  const next = !prev;
                  if (next) setIsInspectorOpen(true);
                  return next;
                })
              }
              aria-expanded={isTemplateMenuOpen}
              aria-controls="seed-templates-pocket"
            >
              Templates
            </button>
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
        </div>
        {isTemplateMenuOpen && (
          <div id="seed-templates-pocket" className="templates-pocket">
            <p className="templates-hint">Autofill goal, audience, and constraints instantly.</p>
            {templateError && <p className="error-text">{templateError}</p>}
            {isTemplateListLoading ? (
              <p className="templates-empty">Loading templates…</p>
            ) : seedTemplates.length === 0 ? (
              <p className="templates-empty">No templates available.</p>
            ) : (
              <ul className="templates-list">
                {seedTemplates.map((template) => {
                  const isGenerating = Boolean(templateLoading[template.key]);
                  const taglineText = isGenerating ? 'Generating…' : template.tagline;
                  return (
                    <li key={template.key}>
                      <button
                        type="button"
                        className={`template-pill ${isGenerating ? 'loading' : ''}`}
                        onClick={() => void handleApplySeedTemplate(template.key)}
                        disabled={isGenerating}
                      >
                        <span className="template-pill-label">{template.label}</span>
                        <span className="template-pill-tagline" aria-live="polite">{taglineText}</span>
                        <span className="template-pill-meta">{template.scenario}</span>
                        <span className="template-pill-focus">Focus: {template.focus}</span>
                        <span className="template-pill-angle">Angle: {template.angle}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
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
              {packagedBrief ? (
                <>
                  {packagedSections.length === 0 ? (
                    <div className="node-preview packaged-inspector">
                      <div className="node-preview-header">
                        <span className="node-preview-title">{packagedBrief.title}</span>
                        {packagedMetaLabel && <span className="node-preview-meta">{packagedMetaLabel}</span>}
                      </div>
                      <p className="node-card-info">{packagedSummary || 'Brief ready for download.'}</p>
                    </div>
                  ) : (
                  <div className="node-preview packaged-inspector">
                    <div className="node-preview-header">
                      <span className="node-preview-title">{packagedBrief.title}</span>
                      {packagedMetaLabel && <span className="node-preview-meta">{packagedMetaLabel}</span>}
                    </div>
                    <p className="node-card-info">{packagedSummary || 'Brief ready for download.'}</p>
                    <div className={`brief-preview ${expandedPreviews.packagedBrief ? 'expanded' : ''}`.trim()}>
                      {(expandedPreviews.packagedBrief ? packagedSections : packagedSections.slice(0, 2)).map(
                        (section, index) => {
                          const heading = section.title || `Section ${index + 1}`;
                          const sectionKey = `section-${index}`;
                          const bodyId = `packagedBrief-${sectionKey}`;
                          const isSectionCollapsed = collapsedNodeContent.packagedBrief?.[sectionKey] ?? false;
                          const handleSectionToggle = () => toggleNodeContent('packagedBrief', sectionKey);
                          const bodyText = section.body;
                          const displayBody = expandedPreviews.packagedBrief ? bodyText : truncateText(bodyText, 240);
                          const collapsedPreview = truncateText(bodyText, 200);
                          const { primary, secondary } = formatBriefHeading(heading, index);
                          return (
                            <section
                              key={`${index}-${heading.slice(0, 12)}`}
                              className={`brief-section ${isSectionCollapsed ? 'collapsed' : ''}`.trim()}
                            >
                              <button
                                type="button"
                                className="brief-section-toggle"
                                onClick={handleSectionToggle}
                                aria-expanded={!isSectionCollapsed}
                                aria-controls={bodyId}
                              >
                                <div className="brief-section-heading">
                                  <span className="brief-section-heading-main">{primary}</span>
                                  {secondary && <span className="brief-section-heading-sub">{secondary}</span>}
                                </div>
                                <span className="collapse-indicator brief-collapse-indicator" aria-hidden="true">
                                  {isSectionCollapsed ? '+' : '−'}
                                </span>
                              </button>
                              {isSectionCollapsed && collapsedPreview && (
                                <p className="brief-section-preview">{collapsedPreview}</p>
                              )}
                              <div className="brief-section-body" id={bodyId} hidden={isSectionCollapsed}>
                                <p>{displayBody}</p>
                              </div>
                            </section>
                          );
                        },
                      )}
                    </div>
                    {packagedSections.length > 2 && (
                      <button type="button" className="node-preview-toggle" onClick={() => togglePreviewExpansion('packagedBrief')}>
                        {expandedPreviews.packagedBrief
                          ? 'Collapse brief'
                          : `Show ${packagedSections.length - 2} more section${packagedSections.length - 2 > 1 ? 's' : ''}`}
                      </button>
                    )}
                  </div>
                  )}
                  <pre className="brief-view">{brief || packagedBrief.brief}</pre>
                  {currentRunId && (
                    <a className="download-link" href={briefDownloadUrl(currentRunId)} download>
                      Download Markdown
                    </a>
                  )}
                </>
              ) : brief ? (
                <>
                  <pre className="brief-view">{brief}</pre>
                  {currentRunId && (
                    <a className="download-link" href={briefDownloadUrl(currentRunId)} download>
                      Download Markdown
                    </a>
                  )}
                </>
              ) : runStatus === 'running' ? (
                <p>Packaging brief…</p>
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
