import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { WikiDoc, WikiNote, WikiFlow, GraphNode, GraphEdge } from "../types";

let dbInstances = new Map<string, LanceDBClient>();

export class LanceDBClient {
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async connect(): Promise<void> {
    if (!existsSync(this.dbPath)) mkdirSync(this.dbPath, { recursive: true });
  }

  async indexDoc(doc: WikiDoc): Promise<void> {
    const table = this.tablePath("docs");
    const rows = this.readTable("docs");

    // Remove existing entry for this service
    const filtered = rows.filter(r => r.id !== doc.id);

    const row: Record<string, unknown> = {
      id: doc.id,
      service_name: doc.serviceName,
      service_path: doc.servicePath,
      language: doc.language,
      content: doc.content,
      sections: JSON.stringify(doc.sections),
      indexed_at: doc.indexedAt,
      vector: [],
    };

    filtered.push(row);
    writeFileSync(table, JSON.stringify(filtered), "utf-8");
  }

  async searchDocs(query: string): Promise<WikiDoc[]> {
    const rows = this.readTable("docs");
    const q = query.toLowerCase();

    const matches = rows.filter(r =>
      (r.service_name as string)?.toLowerCase().includes(q) ||
      (r.content as string)?.toLowerCase().includes(q)
    );

    return matches.slice(0, 15).map(r => this.rowToDoc(r));
  }

  async getDoc(serviceName: string): Promise<WikiDoc | null> {
    const rows = this.readTable("docs");
    const row = rows.find(r => r.service_name === serviceName);
    return row ? this.rowToDoc(row) : null;
  }

  async listServices(): Promise<{ name: string; path: string; size: number }[]> {
    const rows = this.readTable("docs");
    return rows.map(r => ({
      name: r.service_name as string,
      path: r.service_path as string,
      size: ((r.content as string)?.length || 0),
    }));
  }

  async deleteDoc(serviceName: string): Promise<boolean> {
    const rows = this.readTable("docs");
    const filtered = rows.filter(r => r.service_name !== serviceName);
    if (filtered.length === rows.length) return false;
    writeFileSync(this.tablePath("docs"), JSON.stringify(filtered), "utf-8");
    return true;
  }

  async clearAll(): Promise<void> {
    for (const table of ["docs", "flows", "notes", "nodes", "edges"]) {
      writeFileSync(this.tablePath(table), "[]", "utf-8");
    }
  }

  async addFlow(flow: WikiFlow): Promise<void> {
      const table = this.tablePath("flows");
      const flows = this.readTable("flows");
      flows.push({
        id: flow.id,
        service_name: flow.serviceName,
        service_path: flow.servicePath,
        flow_name: flow.flowName,
        summary: flow.summary,
        keywords: JSON.stringify(flow.keywords),
        linked_services: JSON.stringify(flow.linkedServices),
        flow_type: flow.flowType,
        content: flow.content,
        file_refs: JSON.stringify(flow.fileRefs),
        events_emitted: JSON.stringify(flow.eventsEmitted),
        events_consumed: JSON.stringify(flow.eventsConsumed),
        saga_id: flow.sagaId,
        indexed_at: flow.indexedAt,
      });
      writeFileSync(table, JSON.stringify(flows), "utf-8");
  }

  async searchFlows(query: string): Promise<WikiFlow[]> {
    const rows = this.readTable("flows");
    const q = query.toLowerCase();
    const matches = rows.filter(r =>
      (r.flow_name as string)?.toLowerCase().includes(q) ||
      (r.service_name as string)?.toLowerCase().includes(q) ||
      (r.summary as string)?.toLowerCase().includes(q) ||
      ((r.keywords as string) || "").toLowerCase().includes(q) ||
      ((r.linked_services as string) || "").toLowerCase().includes(q) ||
      (r.content as string)?.toLowerCase().includes(q)
    );
    return matches.slice(0, 15).map(r => ({
      id: r.id as string,
      serviceName: r.service_name as string,
      servicePath: r.service_path as string,
      flowName: r.flow_name as string,
      summary: r.summary as string,
      keywords: JSON.parse((r.keywords as string) || "[]"),
      linkedServices: JSON.parse((r.linked_services as string) || "[]"),
      flowType: (r.flow_type as WikiFlow["flowType"]) || "happy_path",
      content: r.content as string,
      fileRefs: JSON.parse((r.file_refs as string) || "[]"),
      eventsEmitted: JSON.parse((r.events_emitted as string) || "[]"),
      eventsConsumed: JSON.parse((r.events_consumed as string) || "[]"),
      sagaId: (r.saga_id as string) || "",
      indexedAt: r.indexed_at as number,
    }));
  }

  async listFlows(serviceName?: string, flowType?: string): Promise<WikiFlow[]> {
    const rows = this.readTable("flows");
    let filtered = rows;
    if (serviceName) filtered = filtered.filter(r => r.service_name === serviceName);
    if (flowType) filtered = filtered.filter(r => r.flow_type === flowType);
    return filtered.map(r => ({
      id: r.id as string,
      serviceName: r.service_name as string,
      servicePath: r.service_path as string,
      flowName: r.flow_name as string,
      summary: r.summary as string,
      keywords: JSON.parse((r.keywords as string) || "[]"),
      linkedServices: JSON.parse((r.linked_services as string) || "[]"),
      flowType: (r.flow_type as WikiFlow["flowType"]) || "happy_path",
      content: r.content as string,
      fileRefs: JSON.parse((r.file_refs as string) || "[]"),
      eventsEmitted: JSON.parse((r.events_emitted as string) || "[]"),
      eventsConsumed: JSON.parse((r.events_consumed as string) || "[]"),
      sagaId: (r.saga_id as string) || "",
      indexedAt: r.indexed_at as number,
    }));
  }

  async saveGraph(nodes: GraphNode[], edges: GraphEdge[]): Promise<void> {
    writeFileSync(this.tablePath("nodes"), JSON.stringify(nodes), "utf-8");
    writeFileSync(this.tablePath("edges"), JSON.stringify(edges), "utf-8");
  }

  async loadGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    const nodes = this.readTable("nodes") as unknown as GraphNode[];
    const edges = this.readTable("edges") as unknown as GraphEdge[];
    return { nodes, edges: edges || [] };
  }

  async graphQuery(startId: string, edgeType?: string): Promise<GraphNode[]> {
    const { nodes, edges } = await this.loadGraph();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const matches = edges
      .filter(e => e.from === startId && (!edgeType || e.type === edgeType))
      .map(e => nodeMap.get(e.to))
      .filter((n): n is GraphNode => !!n);
    return matches;
  }

  async graphTrace(fromId: string, toId: string): Promise<GraphNode[]> {
    const { nodes, edges } = await this.loadGraph();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      adj.get(e.from)!.push(e.to);
    }
    // BFS path
    const visited = new Set<string>();
    const parent = new Map<string, string>();
    const queue = [fromId];
    visited.add(fromId);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr === toId) break;
      for (const next of (adj.get(curr) || [])) {
        if (!visited.has(next)) {
          visited.add(next);
          parent.set(next, curr);
          queue.push(next);
        }
      }
    }
    const path: GraphNode[] = [];
    let curr: string | undefined = toId;
    while (curr) {
      const n = nodeMap.get(curr);
      if (n) path.unshift(n);
      curr = parent.get(curr);
    }
    return path.length > 0 && path[0].id === fromId ? path : [];
  }

  async graphImpact(serviceId: string, depth: number): Promise<{ upstream: GraphNode[]; downstream: GraphNode[] }> {
    const { nodes, edges } = await this.loadGraph();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    function bfs(start: string, forward: boolean, maxDepth: number): GraphNode[] {
      const result: GraphNode[] = [];
      const visited = new Set<string>();
      const queue: { id: string; d: number }[] = [{ id: start, d: 0 }];
      visited.add(start);
      while (queue.length > 0) {
        const { id, d } = queue.shift()!;
        if (d >= maxDepth) continue;
        const adj = forward
          ? edges.filter(e => e.from === id).map(e => e.to)
          : edges.filter(e => e.to === id).map(e => e.from);
        for (const next of adj) {
          if (!visited.has(next)) {
            visited.add(next);
            const n = nodeMap.get(next);
            if (n) result.push(n);
            queue.push({ id: next, d: d + 1 });
          }
        }
      }
      return result;
    }

    return {
      downstream: bfs(serviceId, true, depth),
      upstream: bfs(serviceId, false, depth),
    };
  }

  async stats(): Promise<{ services: number; totalChars: number; notes: number; flows: number }> {
    const docs = this.readTable("docs");
    const notes = this.readTable("notes");
    const flows = this.readTable("flows");
    return {
      services: docs.length, totalChars: docs.reduce((s, r) => s + ((r.content as string)?.length || 0), 0),
      notes: notes.length, flows: flows.length,
    };
  }

  async addNote(note: WikiNote): Promise<void> {
    const table = this.tablePath("notes");
    const notes = this.readTable("notes");
    notes.push({
      id: note.id,
      type: note.type,
      topic: note.topic,
      content: note.content,
      context: note.context,
      tags: JSON.stringify(note.tags),
      authored_by: note.authoredBy,
      authored_at: note.authoredAt,
    });
    writeFileSync(table, JSON.stringify(notes), "utf-8");
  }

  async searchNotes(query: string): Promise<WikiNote[]> {
    const rows = this.readTable("notes");
    const q = query.toLowerCase();
    const matches = rows.filter(r =>
      (r.topic as string)?.toLowerCase().includes(q) ||
      (r.content as string)?.toLowerCase().includes(q) ||
      ((r.tags as string) || "").toLowerCase().includes(q) ||
      (r.context as string)?.toLowerCase().includes(q)
    );
    return matches.slice(0, 15).map(r => ({
      id: r.id as string,
      type: (r.type as WikiNote["type"]) || "tip",
      topic: r.topic as string,
      content: r.content as string,
      context: r.context as string,
      tags: JSON.parse((r.tags as string) || "[]"),
      authoredBy: r.authored_by as string,
      authoredAt: r.authored_at as number,
    }));
  }

  async listNotes(type?: string): Promise<WikiNote[]> {
    const rows = this.readTable("notes");
    const filtered = type ? rows.filter(r => r.type === type) : rows;
    return filtered.map(r => ({
      id: r.id as string,
      type: (r.type as WikiNote["type"]) || "tip",
      topic: r.topic as string,
      content: r.content as string,
      context: r.context as string,
      tags: JSON.parse((r.tags as string) || "[]"),
      authoredBy: r.authored_by as string,
      authoredAt: r.authored_at as number,
    }));
  }

  private tablePath(name: string): string {
    return join(this.dbPath, `${name}.json`);
  }

  private readTable(name: string): Record<string, unknown>[] {
    const p = this.tablePath(name);
    if (!existsSync(p)) return [];
    try { return JSON.parse(readFileSync(p, "utf-8")); }
    catch { console.error(`[codebase-wiki] corrupted table: ${p}`); return []; }
  }

  private rowToDoc(r: Record<string, unknown>): WikiDoc {
    let sections: Record<string, string> = {};
    try {
      sections = JSON.parse(r.sections as string);
    } catch { /* ignore */ }

    return {
      id: r.id as string,
      serviceName: r.service_name as string,
      servicePath: r.service_path as string,
      language: r.language as string,
      sections,
      content: r.content as string,
      indexedAt: r.indexed_at as number,
    };
  }
}

export function getClient(dbPath: string): LanceDBClient {
  let client = dbInstances.get(dbPath);
  if (!client) {
    client = new LanceDBClient(dbPath);
    dbInstances.set(dbPath, client);
  }
  return client;
}