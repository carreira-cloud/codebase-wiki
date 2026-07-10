export interface WikiDoc {
  id: string;
  serviceName: string;
  servicePath: string;
  language: string;
  sections: Record<string, string>;
  content: string;
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
  flowType: "happy_path" | "error_path" | "edge_case" | "recovery" | "full";
  content: string;
  indexedAt: number;
}

export interface WikiNote {
  id: string;
  type: "pattern" | "gotcha" | "integration" | "convention" | "decision" | "tip";
  topic: string;
  content: string;
  context: string;
  tags: string[];
  authoredBy: string;
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
