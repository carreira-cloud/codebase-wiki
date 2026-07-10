import { parseGoService, extractGoDeps } from "../parser/go-parser";
import { getClient } from "../lancedb/client";
import type { ServiceAnalysis, GraphNode, GraphEdge } from "../types";

export async function discoverServices(rootPath: string, dbPath: string) {
  const client = getClient(dbPath);
  await client.connect();
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const { join, basename } = require("node:path") as typeof import("node:path");

  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];

  // Find all Go services
  function findServices(dir: string, depth = 0): string[] {
    if (depth > 4) return [];
    const results: string[] = [];
    try {
      const entries = readdirSync(dir);
      for (const e of entries) {
        const full = join(dir, e);
        try {
          if (!statSync(full).isDirectory()) continue;
        } catch { continue; }
        if (["node_modules", ".git", "dist", "build", ".next", "vendor"].includes(e)) continue;
        if (statSync(join(full, "go.mod"), { throwIfNoEntry: false })) {
          results.push(full);
        } else {
          results.push(...findServices(full, depth + 1));
        }
      }
    } catch { /* skip */ }
    return results;
  }

  const services = findServices(rootPath);
  console.log(`   Found ${services.length} Go services`);

  for (const svcPath of services) {
    const svcName = basename(svcPath);
    const svcRelPath = svcPath.replace(rootPath + "/", "");
    const svcId = `service:${svcName}`;

    // AST analysis
    const analysis = parseGoService(svcPath, svcName);
    const deps = extractGoDeps(svcPath);

    // Service node
    allNodes.push({
      id: svcId, type: "Service",
      data: { name: svcName, path: svcRelPath, language: "go", apis: analysis.apis.length, models: analysis.models.length },
    });

    // API nodes
    for (const api of analysis.apis) {
      const apiId = `api:${svcName}:${api.method}:${api.path.replace(/\//g, "_")}`;
      allNodes.push({ id: apiId, type: "API", data: { ...api, service: svcName } });
      allEdges.push({ from: svcId, to: apiId, type: "HAS_API" });
    }

    // Model nodes
    for (const model of analysis.models) {
      const mdlId = `model:${svcName}:${model.name}`;
      allNodes.push({ id: mdlId, type: "Model", data: { ...model, service: svcName } });
      allEdges.push({ from: svcId, to: mdlId, type: "HAS_MODEL" });
    }

    // Event nodes
    for (const evt of analysis.events) {
      const evtId = `event:${svcName}:${evt.name}`;
      allNodes.push({ id: evtId, type: "Event", data: { ...evt, service: svcName } });
      allEdges.push({ from: svcId, to: evtId, type: evt.direction === "inbound" ? "CONSUMES" : "PRODUCES" });
    }

    // File nodes for each file reference
    const filesSeen = new Set<string>();
    for (const api of analysis.apis) {
      const f = api.fileRef.split(":")[0];
      if (!filesSeen.has(f)) {
        filesSeen.add(f);
        allNodes.push({ id: `file:${svcName}:${f}`, type: "File", data: { path: f, service: svcName, type: "handler" } });
      }
    }
    for (const model of analysis.models) {
      const f = model.fileRef.split(":")[0];
      if (!filesSeen.has(f)) {
        filesSeen.add(f);
        allNodes.push({ id: `file:${svcName}:${f}`, type: "File", data: { path: f, service: svcName, type: "model" } });
      }
    }

    console.log(`   ${svcName}: ${analysis.apis.length} APIs, ${analysis.models.length} models, ${analysis.events.length} events`);

    // Dependency edges
    for (const dep of deps) {
      const depSvc = services.find(s => dep.includes(basename(s)));
      if (depSvc && basename(depSvc) !== svcName) {
        allEdges.push({ from: svcId, to: `service:${basename(depSvc)}`, type: "DEPENDS_ON" });
      }
    }
  }

  await client.saveGraph(allNodes, allEdges);

  return {
    nodes: allNodes.length,
    edges: allEdges.length,
    services: services.length,
    apis: allNodes.filter(n => n.type === "API").length,
    models: allNodes.filter(n => n.type === "Model").length,
    events: allNodes.filter(n => n.type === "Event").length,
  };
}
