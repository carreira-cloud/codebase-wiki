import { readFileSync } from "node:fs";
import type { ServiceAnalysis } from "../types";

export function parseGoService(svcPath: string, svcName: string): ServiceAnalysis {
  const analysis: ServiceAnalysis = {
    serviceName: svcName, servicePath: svcPath, language: "go",
    apis: [], models: [], events: [], dependencies: [],
  };

  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");

  function scanDir(dir: string, depth: number = 0) {
    if (depth > 5) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e);
      try { if (statSync(full).isDirectory()) { if (!e.startsWith(".")) scanDir(full, depth + 1); continue; } } catch { continue; }
      if (!e.endsWith(".go") || e.endsWith("_test.go")) continue;

      try {
        const content = readFileSync(full, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const ln = i + 1;

          // Go route registrations
          const routeMatch = line.match(/(?:r|router|api|g)\.\s*(GET|POST|PUT|DELETE|PATCH|HEAD)\s*\(/);
          if (routeMatch) {
            const pathMatch = line.match(/"([^"]+)"/);
            const handlerMatch = line.match(/\)\s*,\s*(\w+)/);
            analysis.apis.push({
              method: routeMatch[1],
              path: pathMatch?.[1] || "(dynamic)",
              handler: handlerMatch?.[1] || "unknown",
              fileRef: `${full.replace(svcPath + "/", "")}:${ln}`,
              auth: content.includes("middleware.Auth") ? "Auth" : content.includes("GatewayAuth") ? "GatewayAuth" : "none",
            });
          }

          // GORM models
          const modelMatch = line.match(/^type\s+(\w+)\s+struct\s*\{/);
          if (modelMatch && /gorm|json/.test(lines.slice(i, Math.min(i + 20, lines.length)).join("\n"))) {
            const fields: string[] = [];
            for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
              const fl = lines[j].trim();
              if (fl === "}" || fl.startsWith("}")) break;
              const fm = fl.match(/^(\w+)\s+/);
              if (fm && fm[1] !== "//" && fm[1] !== "}" && !fm[1].startsWith("_")) fields.push(fm[1]);
            }
            analysis.models.push({
              name: modelMatch[1],
              fields: fields.slice(0, 15).join(", "),
              storage: content.toLowerCase().includes("gorm") ? "MySQL/PostgreSQL (GORM)" : "unknown",
              fileRef: `${full.replace(svcPath + "/", "")}:${ln}`,
            });
          }

          // Event consumers/producers
          if (/(func|handle)\w*.*[Ee]vent|handle\w*.*[Mm]essage|Consume|Publish/.test(line) && line.includes("func")) {
            const nameMatch = line.match(/func\s+\(?\w*\s*\*?\w*\)?\s*(\w+)/);
            const dir = /[Pp]ublish|[Pp]roduce|[Ss]end/.test(line) ? "outbound" : "inbound";
            analysis.events.push({
              name: nameMatch?.[1] || "unknown",
              direction: dir,
              protocol: content.includes("rabbitmq") || content.includes("amqp") ? "AMQP" : "HTTP/webhook",
              fileRef: `${full.replace(svcPath + "/", "")}:${ln}`,
            });
          }
        }
      } catch { /* skip */ }
    }
  }

  scanDir(svcPath);
  return analysis;
}

export function extractGoDeps(svcPath: string): string[] {
  const { join } = require("node:path") as typeof import("node:path");
  const modPath = join(svcPath, "go.mod");
  try {
    const content = readFileSync(modPath, "utf-8");
    const deps: string[] = [];
    for (const line of content.split("\n")) {
      const m = line.trim().match(/^\s*(\S+)\s+v/);
      if (m && !m[1].startsWith("module") && !m[1].includes("//")) {
        deps.push(m[1]);
      }
    }
    return deps;
  } catch { return []; }
}
