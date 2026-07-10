export interface WikiDoc {
  id: string;
  serviceName: string;
  servicePath: string;
  language: string;
  sections: Record<string, string>;
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
