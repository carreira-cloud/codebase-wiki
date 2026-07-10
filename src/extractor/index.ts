import { parseGoService, extractGoDeps } from "../parser/go-parser";
import { getClient } from "../lancedb/client";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import type { GraphNode, GraphEdge, ServiceAnalysis } from "../types";

interface DiscoverConfig {
  exclude: string[];
  max_depth: number;
  maxFileSizeKb: number;
}

function loadConfig(rootPath: string): DiscoverConfig {
  const cfgPath = join(rootPath, ".codebase-wiki", "config.json");
  const defaults: DiscoverConfig = { exclude: [], max_depth: 6, maxFileSizeKb: 500 };
  if (!existsSync(cfgPath)) return defaults;
  try {
    const raw = JSON.parse(readFileSync(cfgPath, "utf-8"));
    return {
      exclude: raw.discovery?.exclude || [],
      max_depth: raw.discovery?.maxDepth ?? defaults.max_depth,
      maxFileSizeKb: raw.discovery?.maxFileSizeKb ?? defaults.maxFileSizeKb,
    };
  } catch { return defaults; }
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor", ".codebase-wiki", "coverage", "__pycache__", ".turbo", ".parcel-cache"]);

function shouldSkip(entry: string, config: DiscoverConfig): boolean {
  if (SKIP_DIRS.has(entry)) return true;
  for (const pattern of config.exclude) {
    let name = pattern
      .replace(/^\*\*\//, "")    // strip **/
      .replace(/\/\*\*$/, "")    // strip /**
      .replace(/\/\*$/, "")      // strip /*
      .replace(/\/$/, "")        // strip trailing /
      .split("/").pop() || "";   // get last segment
    if (entry === name) return true;
  }
  return false;
}

const MARKERS: Record<string, string> = {
  "go.mod": "go",
  "package.json": "typescript",
  "build.gradle.kts": "kotlin",
  "build.gradle": "java",
  "pom.xml": "java",
  "Cargo.toml": "rust",
  "pyproject.toml": "python",
  "setup.py": "python",
  "requirements.txt": "python",
  "composer.json": "php",
  "Gemfile": "ruby",
  "mix.exs": "elixir",
  "Package.swift": "swift",
  ".csproj": "csharp",
  ".sln": "csharp",
};

function detectLanguage(dir: string): string {
  for (const [marker, lang] of Object.entries(MARKERS)) {
    try {
      const entries = readdirSync(dir);
      for (const e of entries) {
        if (e === marker || e.endsWith(marker)) return lang;
      }
    } catch { /* skip */ }
  }
  return "unknown";
}

function findServices(rootPath: string, config: DiscoverConfig): { path: string; name: string; language: string }[] {
  const results: { path: string; name: string; language: string }[] = [];

  function scanDir(dir: string, depth = 0): void {
    if (depth > config.max_depth) return;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }

    for (const e of entries) {
      if (shouldSkip(e, config)) continue;
      if (e.startsWith(".") && e !== ".github") continue;

      const full = join(dir, e);
      let stat: ReturnType<typeof statSync>;
      try { stat = statSync(full); } catch { continue; }
      if (!stat.isDirectory()) continue;

      const lang = detectLanguage(full);
      if (lang !== "unknown") {
        results.push({ path: full, name: basename(full), language: lang });
        // Don't recurse into service directories (they may contain sub-projects)
        continue;
      }

      scanDir(full, depth + 1);
    }
  }

  scanDir(rootPath);
  return results;
}

/**
 * Lightweight route scanner for non-Go services.
 * Uses regex to find HTTP route registrations in common frameworks.
 */
function scanRoutes(filePath: string, rootPath: string): { method: string; path: string; handler: string; fileRef: string; auth: string }[] {
  const routes: { method: string; path: string; handler: string; fileRef: string; auth: string }[] = [];

  let content: string;
  try { content = readFileSync(filePath, "utf-8"); } catch { return routes; }

  const lines = content.split("\n");
  const ext = extname(filePath);

  const patterns: [RegExp, number, number][] = [];
  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
    // Next.js route handlers: export async function GET/POST/PUT/DELETE
    patterns.push([/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)/g, 1, 0]);
    // Express/Koa/Hono: app.get('/path', handler)
    patterns.push([/(?:app|router|api)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"]([^'"]+)['"]/gi, 2, 1]);
    // Express: router.route('/path').get(handler)
    patterns.push([/(?:app|router)\.route\s*\(\s*['"]([^'"]+)['"]/g, 1, 0]);
  } else if (ext === ".go") {
    // Gin/Echo/Chi: r.GET("/path", handler)
    patterns.push([/(?:r|router|g|e)\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(\s*"([^"]+)"/g, 2, 1]);
    // net/http: http.HandleFunc("/path", handler)
    patterns.push([/http\.HandleFunc\s*\(\s*"([^"]+)"/g, 1, 0]);
    // Echo: e.GET("/path")
    patterns.push([/(?:e|echo)\.(GET|POST|PUT|PATCH|DELETE)\s*\(\s*"([^"]+)"/g, 2, 1]);
  } else if (ext === ".kt") {
    // Spring WebFlux: @GetMapping("/path")
    patterns.push([/@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*"([^"]+)"/g, 2, 1]);
    // Ktor: get("/path") { }
    patterns.push([/(get|post|put|delete|patch)\s*\(\s*"([^"]+)"/gi, 2, 1]);
  } else if (ext === ".py") {
    // FastAPI/Flask: @app.get("/path")
    patterns.push([/@(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi, 2, 1]);
    // Flask: @app.route("/path", methods=["GET"])
    patterns.push([/@(?:app|bp)\.route\s*\(\s*['"]([^'"]+)['"]/g, 1, 0]);
  } else if (ext === ".rs") {
    // Actix: #[get("/path")]
    patterns.push([/#\[(get|post|put|delete|patch)\s*\(\s*"([^"]+)"\s*\)/gi, 2, 1]);
    // Rocket: #[get("/path")]
    patterns.push([/#\[(get|post|put|delete|patch)\s*\(\s*"([^"]+)"/gi, 2, 1]);
  } else if (ext === ".rb") {
    // Rails/Sinatra: get '/path' do / post '/path' do
    patterns.push([/(get|post|put|patch|delete|match)\s+['"]([^'"]+)['"]/gi, 2, 1]);
    // Rails resources: resources :users
    patterns.push([/resources\s+:(\w+)/g, 1, 0]);
  } else if (ext === ".cs") {
    // ASP.NET: [HttpGet("/path")]
    patterns.push([/\[Http(Get|Post|Put|Patch|Delete|Head|Options)\s*\(\s*"([^"]+)"\s*\)/gi, 2, 1]);
    // ASP.NET: [Route("/path")]
    patterns.push([/\[Route\s*\(\s*"([^"]+)"/gi, 1, 0]);
    // Minimal API: app.MapGet("/path", handler)
    patterns.push([/(?:app|api)\.Map(Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"/gi, 2, 1]);
  } else if (ext === ".java") {
    // Spring Boot: @GetMapping("/path")
    patterns.push([/@(Get|Post|Put|Patch|Delete|Request)Mapping\s*\(\s*"([^"]+)"/g, 2, 1]);
    // JAX-RS: @Path("/resource") + @GET
    patterns.push([/@Path\s*\(\s*"([^"]+)"/g, 1, 0]);
  }

  for (const [re, pathIdx, methodIdx] of patterns) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content)) !== null) {
      const method = methodIdx > 0 ? match[methodIdx].toLowerCase() : "any";
      let routePath = match[pathIdx];
      if (!routePath || routePath.includes("//")) continue;
      const lineNum = content.substring(0, match.index).split("\n").length;
      routes.push({
        method: method.toUpperCase(),
        path: routePath,
        handler: "",
        auth: "unknown",
        fileRef: `${filePath.replace(rootPath + "/", "")}:${lineNum}`,
      });
    }
  }

  return routes;
}

export async function discoverServices(rootPath: string, dbPath: string) {
  const client = getClient(dbPath);
  await client.connect();

  const config = loadConfig(rootPath);

  const allNodes: GraphNode[] = [];
  const allEdges: GraphEdge[] = [];

  const services = findServices(rootPath, config);
  const langCounts: Record<string, number> = {};
  for (const s of services) langCounts[s.language] = (langCounts[s.language] || 0) + 1;
  console.log(`   Found ${services.length} services: ${Object.entries(langCounts).map(([l, c]) => `${c} ${l}`).join(", ")}`);

  for (const svc of services) {
    const { path: svcPath, name: svcName, language } = svc;
    const svcRelPath = svcPath.replace(rootPath + "/", "");
    const svcId = `service:${svcName}`;

    let analysis: ServiceAnalysis;

    if (language === "go") {
      analysis = parseGoService(svcPath, svcName);
      const deps = extractGoDeps(svcPath);
      for (const dep of deps) {
        const depSvc = services.find(s => s.name === dep);
        if (depSvc && depSvc.name !== svcName) {
          allEdges.push({ from: svcId, to: `service:${depSvc.name}`, type: "DEPENDS_ON" });
        }
      }
    } else {
      const apiRoutes: { method: string; path: string; handler: string; fileRef: string; auth: string }[] = [];
      const scanDir = (dir: string, depth: number): void => {
        if (depth > 8) return;
        let entries: string[];
        try { entries = readdirSync(dir); } catch { return; }
        for (const e of entries) {
          if (shouldSkip(e, config)) continue;
          const full = join(dir, e);
          try {
            const st = statSync(full);
            if (st.isDirectory()) { scanDir(full, depth + 1); continue; }
            if (/\.(ts|tsx|js|jsx|go|kt|py|rs|rb|cs|java|php)$/i.test(e)) {
              if (st.size > config.maxFileSizeKb * 1024) continue;
              apiRoutes.push(...scanRoutes(full, rootPath));
            }
          } catch { /* skip */ }
        }
      };
      scanDir(svcPath, 0);
      analysis = {
        serviceName: svcName, servicePath: svcRelPath, language,
        apis: apiRoutes, models: [], events: [], dependencies: [],
      };
    }

    allNodes.push({
      id: svcId, type: "Service",
      data: { name: svcName, path: svcRelPath, language, apis: analysis.apis.length, models: analysis.models.length },
    });

    for (const api of analysis.apis) {
      const apiId = `api:${svcName}:${api.method}:${api.path.replace(/\//g, "_")}`;
      allNodes.push({ id: apiId, type: "API", data: { ...api, service: svcName } });
      allEdges.push({ from: svcId, to: apiId, type: "HAS_API" });
    }

    for (const model of analysis.models) {
      const mdlId = `model:${svcName}:${model.name}`;
      allNodes.push({ id: mdlId, type: "Model", data: { ...model, service: svcName } });
      allEdges.push({ from: svcId, to: mdlId, type: "HAS_MODEL" });
    }

    for (const evt of analysis.events) {
      const evtId = `event:${svcName}:${evt.name}`;
      allNodes.push({ id: evtId, type: "Event", data: { ...evt, service: svcName } });
      allEdges.push({ from: svcId, to: evtId, type: evt.direction === "inbound" ? "CONSUMES" : "PRODUCES" });
    }

    const filesSeen = new Set<string>();
    for (const api of analysis.apis) {
      const f = api.fileRef.split(":")[0];
      if (!filesSeen.has(f)) { filesSeen.add(f); allNodes.push({ id: `file:${svcName}:${f}`, type: "File", data: { path: f, service: svcName, type: "handler" } }); }
    }
    for (const model of analysis.models) {
      const f = model.fileRef.split(":")[0];
      if (!filesSeen.has(f)) { filesSeen.add(f); allNodes.push({ id: `file:${svcName}:${f}`, type: "File", data: { path: f, service: svcName, type: "model" } }); }
    }

    console.log(`   ${svcName}: ${analysis.apis.length} APIs (${language})`);

    const docContent = `## Overview\n${svcName} — ${analysis.language} service with ${analysis.apis.length} API endpoints.\n\n## APIs\n${analysis.apis.slice(0, 15).map(a => `- ${a.method} ${a.path} \`${a.fileRef}\``).join("\n")}\n${analysis.models.length > 0 ? `\n## Models\n${analysis.models.slice(0, 15).map(m => `- ${m.name} (\`${m.fileRef}\`)`).join("\n")}\n` : ""}${analysis.events.length > 0 ? `\n## Events\n${analysis.events.slice(0, 10).map(e => `- ${e.direction} ${e.name} (\`${e.fileRef}\`)`).join("\n")}\n` : ""}`;
    await client.indexDoc({
      id: svcName, serviceName: svcName, servicePath: svcRelPath, language: analysis.language,
      sections: {}, content: docContent, indexedAt: Date.now(),
    });
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
