export interface MetricEntry {
  id: string;
  sessionId: string;
  source: "mcp" | "cli" | "ui";
  tool: string;
  model?: string;
  provider?: string;
  tokensIn: number;
  tokensOut: number;
  cacheHit: boolean;
  durationMs: number;
  error?: string;
  timestamp: number;
}

export interface WikiProvenance {
  sourceCommit: string;
  sourceHash: string;
  generatedAt: number;
  lastSeenAt: number;
  generator: "static" | "llm" | "human";
  model?: string;
  provider?: string;
  promptVersion?: string;
  runId?: string;
  confidence: number;
  evidence: string[];
  status: "current" | "stale" | "proposed" | "approved" | "rejected" | "superseded";
}

export interface WikiDoc {
  id: string;
  serviceName: string;
  servicePath: string;
  language: string;
  sections: Record<string, string>;
  content: string;
  provenance: WikiProvenance;
  indexedAt: number;
}

export interface WikiFlow {
  id: string;
  serviceName: string;
  servicePath: string;
  flowName: string;
  summary: string;
  keywords: string[];
  linkedServices: string[];
  flowType: "happy_path" | "error_path" | "edge_case" | "recovery" | "full" | "state_machine" | "saga";
  content: string;
  fileRefs: string[];
  eventsEmitted: string[];
  eventsConsumed: string[];
  sagaId: string;
  provenance: WikiProvenance;
  indexedAt: number;
}

// --- Graph types ---

export type GraphNodeType = "Service" | "API" | "Model" | "Flow" | "FlowStep" | "Event" | "File";

export type GraphEdgeType = "HAS_API" | "HAS_MODEL" | "HAS_FLOW" | "DEPENDS_ON" |
  "STEP" | "REFERENCES" | "CALLS" | "TRIGGERS" | "COMPENSATES" | "PRODUCES" | "CONSUMES";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  data: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: GraphEdgeType;
  data?: Record<string, unknown>;
}

export interface ServiceAnalysis {
  serviceName: string;
  servicePath: string;
  language: string;
  apis: { method: string; path: string; handler: string; fileRef: string; auth: string }[];
  models: { name: string; fields: string; storage: string; fileRef: string }[];
  events: { name: string; direction: string; protocol: string; fileRef: string }[];
  dependencies: string[];
}

export interface WikiNote {
  id: string;
  type: "pattern" | "gotcha" | "integration" | "convention" | "decision" | "tip";
  topic: string;
  content: string;
  context: string;
  tags: string[];
  authoredBy: string;
  evidence: string[];
  confidence: number;
  status: "current" | "stale" | "proposed" | "approved" | "rejected" | "superseded";
  authoredAt: number;
}

export interface MCPRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

export interface MCPToolResponse {
  jsonrpc: "2.0";
  id: number | string;
  result: { content: { type: "text"; text: string }[] };
}

export interface MCPListToolsResponse {
  jsonrpc: "2.0";
  id: number | string;
  result: {
    tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
  };
}
