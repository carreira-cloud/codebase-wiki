import { join } from "node:path";
import type { MCPRequest, MCPToolResponse, MCPListToolsResponse, WikiDoc, WikiNote, WikiFlow } from "./types";
import { getClient } from "./lancedb/client";

const DEFAULT_DB_PATH = ".codebase-wiki/rag_db";
const MCP_SESSION_ID = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function trackCall(tool: string, durationMs: number): void {
  try {
    const dbPath = (process.env.WIKI_DB_PATH) || join(process.cwd(), DEFAULT_DB_PATH);
    const client = getClient(dbPath);
    client.connect().then(() => client.addMetric({
      id: `mcp-${Date.now()}`,
      sessionId: MCP_SESSION_ID,
      source: "mcp",
      tool,
      tokensIn: 0,
      tokensOut: 0,
      cacheHit: false,
      durationMs,
      timestamp: Date.now(),
    })).catch(() => {});
  } catch { /* fail-open */ }
}

const TOOLS = [
  {
    name: "wiki_index",
    description: "Index an LLM-generated architectural document for a service into the knowledge base",
    inputSchema: {
      type: "object",
      properties: {
        service_name: { type: "string", description: "Name of the service/package" },
        service_path: { type: "string", description: "Relative path within the repository" },
        language: { type: "string", description: "Primary language (go, typescript, python, etc.)" },
        content: { type: "string", description: "Full markdown architectural documentation" },
        sections: {
          type: "object",
          description: "Key-value of section names to their content (overview, architecture, dataModel, apiEndpoints, dataFlow, integrationPoints, errorHandling, security, configuration)",
        },
      },
      required: ["service_name", "content"],
    },
  },
  {
    name: "wiki_search",
    description: "Search indexed architectural documentation by keyword or concept",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (service name, concept, keyword)" },
      },
      required: ["query"],
    },
  },
  {
    name: "wiki_get",
    description: "Retrieve full architectural documentation for a specific service",
    inputSchema: {
      type: "object",
      properties: {
        service_name: { type: "string", description: "Exact service name to retrieve" },
      },
      required: ["service_name"],
    },
  },
  {
    name: "wiki_list",
    description: "List all services with indexed architectural documentation",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "wiki_delete",
    description: "Remove a service's documentation from the knowledge base",
    inputSchema: {
      type: "object",
      properties: {
        service_name: { type: "string" },
      },
      required: ["service_name"],
    },
  },
  {
    name: "wiki_stats",
    description: "Show knowledge base statistics (service count, total content size, notes count)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "wiki_note",
    description: "Store a self-learning note — when the agent discovers an important pattern, gotcha, integration detail, convention, decision, or tip during its work",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Note type: pattern, gotcha, integration, convention, decision, or tip" },
        topic: { type: "string", description: "Short title summarizing the discovery" },
        content: { type: "string", description: "What was discovered and why it matters" },
        context: { type: "string", description: "Where was this discovered (file paths, service, scenario)" },
        tags: { type: "string", description: "Comma-separated tags for discoverability" },
      },
      required: ["type", "topic", "content"],
    },
  },
  {
    name: "wiki_notes_search",
    description: "Search self-learning notes by keyword — find patterns, gotchas, and conventions discovered by agents",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search across topic, content, tags, and context" },
        status: { type: "string", description: "Filter by status. Defaults to exclude 'proposed'." },
      },
      required: ["query"],
    },
  },
  {
    name: "wiki_notes_list",
    description: "List all self-learning notes, optionally filtered by type",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Filter by note type (pattern, gotcha, integration, convention, decision, tip)" },
        status: { type: "string", description: "Filter by status (proposed, approved, current, rejected). Defaults to exclude 'proposed' for agents fetching knowledge." },
      },
    },
  },
  {
    name: "wiki_flow_index",
    description: "Index a workflow/sequence diagram — happy path, error path, edge case, or recovery flow",
    inputSchema: {
      type: "object",
      properties: {
        service_name: { type: "string" },
        service_path: { type: "string" },
        flow_name: { type: "string", description: "e.g. 'Checkout — Happy Path', 'Fulfillment Retry — Exponential Backoff'" },
        summary: { type: "string", description: "One-line description of the flow" },
        keywords: { type: "string", description: "Comma-separated keywords for discoverability" },
        linked_services: { type: "string", description: "Comma-separated services involved in this flow" },
        flow_type: { type: "string", description: "happy_path, error_path, edge_case, recovery, full, state_machine, or saga" },
        content: { type: "string", description: "Mermaid diagram + text description" },
        file_refs: { type: "string", description: "Comma-separated source file paths referenced by this flow (e.g. 'src/handler/checkout.go:45,src/service/order.go:120')" },
        events_emitted: { type: "string", description: "Comma-separated event names this flow publishes" },
        events_consumed: { type: "string", description: "Comma-separated event names this flow subscribes to" },
        saga_id: { type: "string", description: "Saga identifier linking related flows across services" },
      },
      required: ["service_name", "flow_name", "content"],
    },
  },
  {
    name: "wiki_flow_search",
    description: "Search indexed workflows by keyword — finds flows across all services",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        service: { type: "string", description: "Optional: filter by service name" },
      },
      required: ["query"],
    },
  },
  {
    name: "wiki_flow_list",
    description: "List all indexed workflows, optionally filtered by service or flow type",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string" },
        flow_type: { type: "string" },
      },
    },
  },
  {
    name: "wiki_graph_query",
    description: "Query the architecture graph — traverse from a node by edge type",
    inputSchema: {
      type: "object",
      properties: {
        start_id: { type: "string", description: "Starting node ID (e.g. service:oms-microservice)" },
        edge_type: { type: "string", description: "Edge type to traverse (HAS_API, HAS_FLOW, DEPENDS_ON, etc.)" },
      },
      required: ["start_id"],
    },
  },
  {
    name: "wiki_graph_trace",
    description: "Find the shortest path between two graph nodes",
    inputSchema: {
      type: "object",
      properties: {
        from_id: { type: "string" },
        to_id: { type: "string" },
      },
      required: ["from_id", "to_id"],
    },
  },
  {
    name: "wiki_graph_impact",
    description: "Analyze blast radius — find upstream and downstream dependencies from a service",
    inputSchema: {
      type: "object",
      properties: {
        service_id: { type: "string", description: "Service node ID (e.g. service:oms-microservice)" },
        depth: { type: "number", "default": 2, description: "How many hops to traverse" },
      },
      required: ["service_id"],
    },
  },
  {
    name: "wiki_graph_file",
    description: "Find all graph nodes that reference a specific source file",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "File path or partial match" },
      },
      required: ["file_path"],
    },
  },
];

export async function handleMCPRequest(request: string): Promise<string> {
  let req: MCPRequest;
  try {
    req = JSON.parse(request);
  } catch {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  }

  if (req.method === "tools/list") {
    const resp: MCPListToolsResponse = {
      jsonrpc: "2.0",
      id: req.id,
      result: { tools: TOOLS },
    };
    return JSON.stringify(resp);
  }

  if (req.method === "tools/call") {
    const toolName = req.params?.name || "";
    const args = req.params?.arguments || {};
    const start = Date.now();

    try {
      const result = await callTool(toolName, args);
      trackCall(toolName, Date.now() - start);
      const resp: MCPToolResponse = {
        jsonrpc: "2.0",
        id: req.id,
        result: { content: [{ type: "text", text: result }] },
      };
      return JSON.stringify(resp);
    } catch (err) {
      return JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32000, message: String(err) },
      });
    }
  }

  if (req.method === "initialize") {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: req.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "codebase-wiki", version: "0.1.0" },
      },
    });
  }

  return JSON.stringify({
    jsonrpc: "2.0",
    id: req.id,
    error: { code: -32601, message: `Unknown method: ${req.method}` },
  });
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const dbPath = (process.env.WIKI_DB_PATH) || join(process.cwd(), DEFAULT_DB_PATH);
  const client = getClient(dbPath);
  await client.connect();

  switch (name) {
    case "wiki_index": {
      const doc: WikiDoc = {
        id: args.service_name as string,
        serviceName: args.service_name as string,
        servicePath: (args.service_path as string) || "",
        language: (args.language as string) || "unknown",
        sections: (args.sections as Record<string, string>) || {},
        content: args.content as string,
        provenance: {
          sourceCommit: "", sourceHash: "",
          generatedAt: Date.now(), lastSeenAt: Date.now(),
          generator: "human",
          confidence: 1.0, evidence: [], status: "current",
        },
        indexedAt: Date.now(),
      };
      await client.indexDoc(doc);
      return `Documentation indexed for "${doc.serviceName}" (${Math.floor(doc.content.length / 1000)}K chars)`;
    }

    case "wiki_search": {
      const docs = await client.searchDocs(args.query as string);
      return JSON.stringify(docs.map((d: WikiDoc) => ({
        name: d.serviceName,
        path: d.servicePath,
        preview: d.content.slice(0, 200),
      })), null, 2);
    }

    case "wiki_get": {
      const doc = await client.getDoc(args.service_name as string);
      if (!doc) return `No documentation found for "${args.service_name}"`;
      return doc.content;
    }

    case "wiki_list": {
      const services = await client.listServices();
      return JSON.stringify(services, null, 2);
    }

    case "wiki_delete": {
      const ok = await client.deleteDoc(args.service_name as string);
      return ok ? `Deleted "${args.service_name}"` : `"${args.service_name}" not found`;
    }

    case "wiki_stats": {
      const stats = await client.stats();
      return `${stats.services} services indexed, ${Math.floor(stats.totalChars / 1000)}K chars, ${stats.notes} agent notes`;
    }

    case "wiki_note": {
      const id = `note-${Date.now()}`;
      await client.addNote({
        id,
        type: (args.type as WikiNote["type"]) || "tip",
        topic: args.topic as string,
        content: args.content as string,
        context: (args.context as string) || "",
        tags: typeof args.tags === "string" ? args.tags.split(",").map(t => t.trim()) : [],
        authoredBy: "agent",
        evidence: [],
        confidence: 0.8,
        status: "proposed",
        authoredAt: Date.now(),
      });
      return `Note stored: [${args.type}] "${args.topic}"`;
    }

    case "wiki_notes_search": {
      const notes = await client.searchNotes(args.query as string);
      const statusFilter = (args.status as string) || "";
      const filtered = statusFilter
        ? notes.filter(n => n.status === statusFilter)
        : notes.filter(n => n.status !== "proposed");
      return JSON.stringify(filtered.map(n => ({
        type: n.type,
        topic: n.topic,
        snippet: n.content.slice(0, 200),
        context: n.context,
        tags: n.tags,
        status: n.status,
      })), null, 2);
    }

    case "wiki_notes_list": {
      const notes = await client.listNotes((args.type as string) || undefined);
      const statusFilter = (args.status as string) || "";
      const filtered = statusFilter
        ? notes.filter(n => n.status === statusFilter)
        : notes.filter(n => n.status !== "proposed");
      return JSON.stringify(filtered.map(n => ({
        type: n.type,
        topic: n.topic,
        context: n.context,
        tags: n.tags,
        status: n.status,
      })), null, 2);
    }

    case "wiki_flow_index": {
      const id = `${args.service_name}_${args.flow_name}`;
      await client.addFlow({
        id, serviceName: args.service_name as string, servicePath: (args.service_path as string) || "",
        flowName: args.flow_name as string, summary: (args.summary as string) || "",
        keywords: typeof args.keywords === "string" ? args.keywords.split(",").map((k: string) => k.trim()) : [],
        linkedServices: typeof args.linked_services === "string" ? args.linked_services.split(",").map((s: string) => s.trim()) : [],
        flowType: (args.flow_type as WikiFlow["flowType"]) || "happy_path",
        content: args.content as string,
        fileRefs: typeof args.file_refs === "string" ? args.file_refs.split(",").map((f: string) => f.trim()) : [],
        eventsEmitted: typeof args.events_emitted === "string" ? args.events_emitted.split(",").map((e: string) => e.trim()) : [],
        eventsConsumed: typeof args.events_consumed === "string" ? args.events_consumed.split(",").map((e: string) => e.trim()) : [],
        sagaId: (args.saga_id as string) || "",
        provenance: {
          sourceCommit: "", sourceHash: "",
          generatedAt: Date.now(), lastSeenAt: Date.now(),
          generator: "human",
          confidence: 1.0, evidence: [], status: "current",
        },
        indexedAt: Date.now(),
      });
      return `Flow indexed: "${args.flow_name}" [${args.flow_type}]`;
    }

    case "wiki_flow_search": {
      const flows = await client.searchFlows(args.query as string);
      const filtered = args.service ? flows.filter(f => f.serviceName === args.service) : flows;
      return JSON.stringify(filtered.map(f => ({
        service: f.serviceName, flow: f.flowName, type: f.flowType,
        summary: f.summary, keywords: f.keywords, linked: f.linkedServices,
        files: f.fileRefs, events: {emitted: f.eventsEmitted, consumed: f.eventsConsumed},
        saga: f.sagaId || undefined,
      })), null, 2);
    }

    case "wiki_flow_list": {
      const flows = await client.listFlows((args.service as string) || undefined, (args.flow_type as string) || undefined);
      return JSON.stringify(flows.map(f => ({
        service: f.serviceName, flow: f.flowName, type: f.flowType,
        keywords: f.keywords, linked: f.linkedServices,
        files: f.fileRefs, events: {emitted: f.eventsEmitted, consumed: f.eventsConsumed},
        saga: f.sagaId || undefined,
      })), null, 2);
    }

    case "wiki_graph_query": {
      const nodes = await client.graphQuery(args.start_id as string, (args.edge_type as string) || undefined);
      return JSON.stringify(nodes.map(n => ({ id: n.id, type: n.type, ...n.data })), null, 2);
    }

    case "wiki_graph_trace": {
      const path = await client.graphTrace(args.from_id as string, args.to_id as string);
      if (path.length === 0) return "No path found";
      return path.map((n, i) => `${i === 0 ? "" : " → "}[${n.type}] ${n.data.name || n.data.path || n.id}`).join("");
    }

    case "wiki_graph_impact": {
      const svcId = args.service_id as string;
      const depth = Math.min((args.depth as number) || 2, 10);
      const impact = await client.graphImpact(svcId, depth);
      return JSON.stringify({
        downstream: impact.downstream.length + " nodes",
        upstream: impact.upstream.length + " nodes",
        downstream_nodes: impact.downstream.map(n => ({ id: n.id, type: n.type, ...n.data })),
        upstream_nodes: impact.upstream.map(n => ({ id: n.id, type: n.type, ...n.data })),
      }, null, 2);
    }

    case "wiki_graph_file": {
      const { nodes } = await client.loadGraph();
      const matches = nodes.filter(n =>
        ((n.data.fileRef || n.data.path || "") as string).includes(args.file_path as string) ||
        n.id.includes(args.file_path as string)
      );
      return JSON.stringify(matches.map(n => ({ id: n.id, type: n.type, ...n.data })), null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
