#!/usr/bin/env node
import { Command } from "commander";
import { cpSync, existsSync, mkdirSync, statSync, watch, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { handleMCPRequest } from "./mcp-server";
import { getClient } from "./lancedb/client";
import type { WikiFlow } from "./types";
import { startUIServer } from "./ui-server";
import { discoverServices } from "./extractor/index";

const __dirname = dirname(fileURLToPath(import.meta.url));

const program = new Command();

program
  .name("codebase-wiki")
  .description("Architectural knowledge base with MCP interface for AI agents")
  .version("0.1.0");

program
  .command("start-mcp")
  .description("Start MCP server (stdio JSON-RPC)")
  .action(() => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

    rl.on("line", async (line: string) => {
      if (!line.trim()) return;
      const response = await handleMCPRequest(line.trim());
      process.stdout.write(response + "\n");
    });

    process.stderr.write("codebase-wiki MCP server ready\n");

    rl.on("close", () => process.exit(0));
  });

program
  .command("init")
  .description("Initialize knowledge base for current repo")
  .action(() => {
    const rootPath = process.cwd();
    const dbDir = join(rootPath, ".codebase-wiki");
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    console.log("✔ Knowledge base initialized at .codebase-wiki/");
    console.log("  Commands:");
    console.log("    codebase-wiki start-mcp     → Start MCP server for AI agents");
    console.log("    codebase-wiki serve          → Start web UI to explore content");
    console.log("    codebase-wiki search <q>     → Search documentation");
    console.log("    codebase-wiki list           → List all indexed services");
    console.log("  Run `codebase-wiki serve` to launch the exploration UI.");
  });

program
  .command("serve")
  .description("Start web UI to browse the knowledge base")
  .option("-p, --port <port>", "Port to listen on", "3080")
  .action(async (options: { port: string }) => {
    const port = parseInt(options.port, 10);
    const dbPath = join(process.cwd(), ".codebase-wiki/rag_db");
    console.log(`\n🧠 Codebase Wiki UI → http://localhost:${port}\n`);
    const server = await startUIServer(port, dbPath);
    console.log(`   Press Ctrl+C to stop.\n`);
    process.on("SIGINT", () => { server.stop(); process.exit(0); });
  });

  program
    .command("discover")
    .description("Full auto-discovery: scan repo, extract APIs/models/events, build graph")
    .option("--llm", "Enable LLM deep discovery (3-phase per service: docs → flows → notes)")
    .option("--reset", "Clear all existing data before discovery (docs, flows, notes)")
    .action(async (options: { llm?: boolean; reset?: boolean }) => {
      const rootPath = process.cwd();
      const dbPath = join(rootPath, ".codebase-wiki/rag_db");

      if (options.reset) {
        console.log("\n🧹 Resetting all wiki data...");
        const client = getClient(dbPath);
        await client.connect();
        await client.clearAll();
        console.log("   ✔ Cleared: docs, flows, notes, graph\n");
      }

      console.log("\n🔍 Full discovery scan...\n");
      const result = await discoverServices(rootPath, dbPath);
      console.log(`\n✔ Graph built: ${result.nodes} nodes, ${result.edges} edges`);
      console.log(`   ${result.services} services, ${result.apis} APIs, ${result.models} models, ${result.events} events`);

      if (options.llm) {
        console.log("\n🧠 LLM Deep Discovery (3-phase per service: docs → flows → notes)...\n");
        const client = getClient(dbPath);
        await client.connect();
        const { nodes } = await client.loadGraph();
        const services = nodes.filter(n => n.type === "Service");

        for (const svc of services) {
          const svcName = svc.data.name as string;
          const svcPath = (svc.data.path as string) || svcName;
          const language = (svc.data.language as string) || "unknown";

          // Gather AST context
          const svcApis = nodes.filter(n => n.type === "API" && (n.data.service as string) === svcName);
          const svcModels = nodes.filter(n => n.type === "Model" && (n.data.service as string) === svcName);
          const svcEvents = nodes.filter(n => n.type === "Event" && (n.data.service as string) === svcName);

          // Read real source files (language-agnostic)
          const fileContext = readServiceFiles(rootPath, svcPath, language);

          const astContext = `APIs (${svcApis.length}):
  ${svcApis.map(a => `- ${a.data.method} ${a.data.path} (${a.data.fileRef})`).join("\n").slice(0, 2000)}

  Models (${svcModels.length}):
  ${svcModels.map(m => `- ${m.data.name} (${m.data.fileRef})`).join("\n").slice(0, 1500)}

  ${svcEvents.length > 0 ? `Events (${svcEvents.length}):\n${svcEvents.map(e => `- ${e.data.direction} ${e.data.name} (${e.data.fileRef})`).join("\n").slice(0, 1000)}` : ""}`;

          const serviceInfo = `Service: ${svcName} | Language: ${language} | Path: ${svcPath}`;

          try {
            process.stdout.write(`   📝 ${svcName} `);

            // Phase 1: Generate wiki doc
            const docResult = await phaseGenerateDoc(svcName, svcPath, serviceInfo, fileContext, astContext);
            process.stdout.write(`📖`);

            // Phase 2: Generate flows (sequences + state machines)
            const flowCount = await phaseGenerateFlows(svcName, svcPath, serviceInfo, fileContext, astContext);
            process.stdout.write(`${flowCount > 3 ? '🔄🧬' : '🔄'}`);

            // Phase 3: Generate notes
            const noteCount = await phaseGenerateNotes(svcName, svcPath, serviceInfo, fileContext, astContext);
            console.log(` doc:${docResult}K flows:${flowCount} (incl state machines) notes:${noteCount}`);
          } catch (e) {
            console.log(` ⚠ ${String(e).slice(0, 80)}`);
          }
      }
      console.log(`\n✔ Deep discovery complete\n`);

      // Post-processing: compose sagas from flows that share saga IDs
      const allFlows = await client.listFlows();
      const sagaGroups = new Map<string, WikiFlow[]>();
      for (const f of allFlows) {
        if (f.sagaId && f.flowType !== "saga") {
          if (!sagaGroups.has(f.sagaId)) sagaGroups.set(f.sagaId, []);
          sagaGroups.get(f.sagaId)!.push(f);
        }
      }

      if (sagaGroups.size > 0) {
        console.log(`\n🔗 Composing ${sagaGroups.size} sagas...\n`);
        for (const [sagaId, members] of sagaGroups) {
          if (members.length < 2) continue;
          const services = [...new Set(members.map(f => f.serviceName))];
          const allEvents = {
            emitted: [...new Set(members.flatMap(f => f.eventsEmitted))],
            consumed: [...new Set(members.flatMap(f => f.eventsConsumed))],
          };

          const sagaContent = `## Saga: ${sagaId}

### Participating Services
${services.map(s => `- **${s}**`).join("\n")}

### Event Flow
${allEvents.emitted.length > 0 ? `**Emitted:** ${allEvents.emitted.map(e => `\`${e}\``).join(", ")}\n` : ""}${allEvents.consumed.length > 0 ? `**Consumed:** ${allEvents.consumed.map(e => `\`${e}\``).join(", ")}\n` : ""}

### Member Flows
${members.map(f => `- [${f.serviceName}] ${f.flowName} (${f.flowType})`).join("\n")}

### Full Saga Diagram
\`\`\`mermaid
sequenceDiagram
${members.map(f => {
  const mermaidMatch = f.content.match(/```mermaid\nsequenceDiagram\n([\s\S]*?)```/);
  if (mermaidMatch) {
    return `  Note over ${f.serviceName}: ${f.flowName}\n${mermaidMatch[1].split('\n').filter(l => l.trim()).map(l => '  ' + l).join('\n')}`;
  }
  return `  Note over ${f.serviceName}: ${f.flowName} (see individual flow)`;
}).join('\n\n')}
\`\`\`
`;

          await client.addFlow({
            id: `saga_${sagaId}`, serviceName: services[0] || "", servicePath: "",
            flowName: `Saga: ${sagaId}`,
            summary: `Saga spanning ${services.length} services: ${services.join(", ")}. ${members.length} flows, ${allEvents.emitted.length} events emitted, ${allEvents.consumed.length} consumed.`,
            keywords: ["saga", sagaId, ...services],
            linkedServices: services,
            flowType: "saga",
            content: sagaContent,
            fileRefs: members.flatMap(f => f.fileRefs),
            eventsEmitted: allEvents.emitted,
            eventsConsumed: allEvents.consumed,
            sagaId,
            indexedAt: Date.now(),
          });
          console.log(`   📐 ${sagaId}: ${members.length} flows across ${services.length} services`);
        }
        console.log(`\n✔ Saga composition complete\n`);
      }
      } else {
        console.log(`\n   (use --llm to enable deep LLM discovery: 3-phase per service)\n`);
        console.log(`   (use --reset --llm to clear all data and regenerate)\n`);
      }
    });

  program
    .command("reset")
    .description("Clear all wiki data (docs, flows, notes, graph)")
    .action(async () => {
      const rootPath = process.cwd();
      const dbPath = join(rootPath, ".codebase-wiki/rag_db");
      console.log("\n🧹 Resetting all wiki data...");
      const client = getClient(dbPath);
      await client.connect();
      await client.clearAll();
      console.log("   ✔ Cleared: docs, flows, notes, graph");
      console.log("   Run 'codebase-wiki discover --llm' to regenerate.\n");
    });program
  .command("watch")
  .description("Watch for file changes and auto-update the knowledge base")
  .option("-d, --debounce <ms>", "Debounce in ms", "10000")
  .action(async (options: { debounce: string }) => {
    const rootPath = process.cwd();
    const dbPath = join(rootPath, ".codebase-wiki/rag_db");
    const debounce = parseInt(options.debounce, 10);

    console.log(`\n👁️  Watching for changes (debounce: ${debounce}ms)...\n`);
    console.log("   (Changes to .go/.ts/.kt files will trigger re-indexing)\n");

    let timer: ReturnType<typeof setTimeout> | null = null;
    let changedFiles = new Set<string>();

    // Simple polling watcher
    try {
      const watcher = watch(rootPath, { recursive: true }, (_event: string, filename: string | null) => {
        if (!filename || filename.includes("node_modules") || filename.includes(".git")) return;
        if (!/\.(go|ts|tsx|kt|yaml|yml)$/.test(filename)) return;
        changedFiles.add(filename);
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          const files = [...changedFiles];
          changedFiles = new Set();
          console.log(`\n📝 Changed: ${files.slice(0, 5).join(", ")}${files.length > 5 ? " +" + (files.length - 5) + " more" : ""}`);
          console.log("   Re-indexing...");
          const result = await discoverServices(rootPath, dbPath);
          console.log(`   ✔ ${result.services} services, ${result.apis} APIs, ${result.models} models\n`);
        }, debounce);
      });
      process.on("SIGINT", () => { watcher.close(); process.exit(0); });
    } catch (e) {
      console.log(`   Polling fallback: re-scan every ${Math.floor(debounce / 1000)}s`);
      setInterval(async () => {
        const result = await discoverServices(rootPath, dbPath);
        console.log(`   Re-scan: ${result.services} services, ${result.apis} APIs`);
      }, debounce * 6);
    }
  });

program
  .command("search <query>")
  .description("Search indexed documentation")
  .action(async (query: string) => {
    const dbPath = join(process.cwd(), ".codebase-wiki/rag_db");
    const client = getClient(dbPath);
    await client.connect();
    const docs = await client.searchDocs(query);
    console.log(`\n🔍 "${query}" — ${docs.length} results:\n`);
    for (const d of docs) {
      console.log(`   ${d.serviceName} [${d.servicePath}]`);
      console.log(`   ${d.content.slice(0, 150).replace(/\n/g, " ")}...\n`);
    }
  });

program
  .command("get <service>")
  .description("Get documentation for a service")
  .action(async (name: string) => {
    const dbPath = join(process.cwd(), ".codebase-wiki/rag_db");
    const client = getClient(dbPath);
    await client.connect();
    const doc = await client.getDoc(name);
    if (!doc) {
      console.log(`No docs for "${name}"`);
      return;
    }
    console.log(doc.content);
  });

program
  .command("list")
  .description("List all indexed services")
  .action(async () => {
    const dbPath = join(process.cwd(), ".codebase-wiki/rag_db");
    const client = getClient(dbPath);
    await client.connect();
    const services = await client.listServices();
    console.log(`\n📚 ${services.length} indexed services:\n`);
    for (const s of services) {
      console.log(`   ${s.name} (${s.path}) — ${Math.floor(s.size / 1000)}K`);
    }
    console.log();
  });

program
  .command("stats")
  .description("Show knowledge base stats")
  .action(async () => {
    const dbPath = join(process.cwd(), ".codebase-wiki/rag_db");
    const client = getClient(dbPath);
    await client.connect();
    const stats = await client.stats();
    const { nodes } = await client.loadGraph();
    const services = nodes.filter(n => n.type === "Service").length;
    console.log(`\n📊 ${stats.services} docs, ${stats.flows} flows, ${stats.notes} notes, ${Math.floor(stats.totalChars / 1000)}K chars`);
    if (services > 0) console.log(`🔗 Graph: ${services} services, ${nodes.length} nodes, ${nodes.filter(n=>n.type==='API').length} APIs`);
    console.log();
  });

program
  .command("install-opencode")
  .description("Install OpenCode skills & commands into .opencode/")
  .action(() => {
    const rootPath = process.cwd();
    const openCodeDir = join(rootPath, ".opencode");
    const skillsDir = join(openCodeDir, "skills");
    const commandsDir = join(openCodeDir, "commands");
    const rulesDir = join(openCodeDir, "rules");

    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(commandsDir, { recursive: true });
    mkdirSync(rulesDir, { recursive: true });

    const srcSkills = join(__dirname, "..", "skills");
    const srcCommands = join(__dirname, "..", "commands");
    const srcRules = join(__dirname, "..", "rules");

    if (existsSync(srcSkills)) copyDir(srcSkills, skillsDir);
    if (existsSync(srcCommands)) copyDir(srcCommands, commandsDir);
    if (existsSync(srcRules)) copyDir(srcRules, rulesDir);

    console.log("\n✔ OpenCode skills, commands, and rules installed!");
    console.log("   Skills: .opencode/skills/architectural-planning/, contextual-debugging/");
    console.log("   Commands: .opencode/commands/wiki.md");
    console.log("   Rules: .opencode/rules/codebase_wiki_rules.md");
    console.log("\nNext steps:");
    console.log("   1. Start MCP server:  codebase-wiki start-mcp");
    console.log("   2. Browse the UI:     codebase-wiki serve");
    console.log("   3. Generate docs:     /wiki generate <service-path>\n");
  });

function readServiceFiles(rootPath: string, svcPath: string, language: string): string {
  const parts: string[] = [];
  const fullPath = join(rootPath, svcPath);
  if (!existsSync(fullPath)) return "";

  const patterns = getLanguagePatterns(language);

  // 1. Doc files (README, AGENTS, CONTRIBUTING)
  for (const f of ["README.md", "AGENTS.md", "CONTRIBUTING.md", "ARCHITECTURE.md"]) {
    const p = join(fullPath, f);
    if (existsSync(p)) {
      const content = readFileSync(p, "utf-8");
      parts.push(`### ${f}\n${content.slice(0, 3000)}`);
    }
  }

  // 2. Language-specific config files
  for (const f of patterns.config) {
    const p = join(fullPath, f);
    if (existsSync(p)) {
      const content = readFileSync(p, "utf-8");
      parts.push(`### ${f}\n${content.slice(0, 2000)}`);
    }
  }

  // 3. Env files
  for (const f of [".env.example", ".env.local.example", ".env.template", ".env"]) {
    const p = join(fullPath, f);
    if (existsSync(p)) {
      const content = readFileSync(p, "utf-8");
      parts.push(`### ${f}\n${content.slice(0, 1500)}`);
    }
  }

  // 4. CI/CD + deploy files
  for (const f of ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", "Chart.yaml", "Makefile", ".github/workflows"]) {
    const p = join(fullPath, f);
    if (existsSync(p)) {
      if (statSync(p).isDirectory()) {
        parts.push(`### ${f}/ (CI/CD directory present)`);
      } else {
        const content = readFileSync(p, "utf-8");
        parts.push(`### ${f}\n${content.slice(0, 1500)}`);
      }
    }
  }

  // 5. Generic config files (not already covered by language patterns)
  const genericConfigs = ["tsconfig.json", "eslint.config.mjs", ".eslintrc.js", ".eslintrc.json", ".prettierrc", "next.config.js", "next.config.mjs", "next.config.ts", "vite.config.ts", "vitest.config.ts"];
  for (const f of genericConfigs) {
    if (patterns.config.includes(f)) continue; // already covered
    const p = join(fullPath, f);
    if (existsSync(p)) {
      const content = readFileSync(p, "utf-8");
      parts.push(`### ${f}\n${content.slice(0, 1000)}`);
    }
  }

  // 6. Entry point based on language
  for (const f of patterns.entry) {
    const p = join(fullPath, f);
    if (existsSync(p)) {
      const content = readFileSync(p, "utf-8");
      parts.push(`### ${f}\n${content.slice(0, 2000)}`);
      break;
    }
  }

  return parts.join("\n\n");
}

function getLanguagePatterns(language: string): { config: string[]; entry: string[] } {
  const LANG_PATTERNS: Record<string, { config: string[]; entry: string[] }> = {
    go: {
      config: ["go.mod"],
      entry: ["cmd/server/main.go", "cmd/main.go", "main.go"],
    },
    typescript: {
      config: ["package.json", "tsconfig.json"],
      entry: ["src/index.ts", "src/app/layout.tsx", "src/app/page.tsx", "src/main.ts", "src/server.ts"],
    },
    javascript: {
      config: ["package.json"],
      entry: ["src/index.js", "src/app/layout.jsx", "src/server.js"],
    },
    python: {
      config: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "uv.lock", "Pipfile"],
      entry: ["main.py", "src/main.py", "app.py", "src/app.py", "__main__.py"],
    },
    rust: {
      config: ["Cargo.toml"],
      entry: ["src/main.rs", "src/bin/main.rs"],
    },
    kotlin: {
      config: ["build.gradle.kts", "build.gradle", "settings.gradle.kts"],
      entry: [],
    },
    java: {
      config: ["pom.xml", "build.gradle.kts", "build.gradle"],
      entry: [],
    },
    csharp: {
      config: [],
      entry: ["Program.cs", "Startup.cs"],
    },
    ruby: {
      config: ["Gemfile"],
      entry: [],
    },
    php: {
      config: ["composer.json"],
      entry: ["public/index.php", "index.php"],
    },
    elixir: {
      config: ["mix.exs"],
      entry: ["lib/**/application.ex"],
    },
    swift: {
      config: ["Package.swift"],
      entry: ["Sources/**/main.swift"],
    },
  };

  return LANG_PATTERNS[language] || {
    config: ["package.json", "go.mod", "Cargo.toml", "pyproject.toml", "build.gradle.kts", "build.gradle", "pom.xml", "composer.json", "Gemfile", "Makefile", "mix.exs", "Package.swift"],
    entry: ["main.go", "main.py", "main.rs", "src/index.ts", "src/index.js", "src/index.tsx", "src/main.ts", "src/server.ts", "src/app.ts", "app.py", "server.js", "Program.cs"],
  };
}

function copyDir(src: string, dest: string): void {
  cpSync(src, dest, { recursive: true });
}

async function callLLM(systemPrompt: string, userContent: string): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const url = process.env.WIKI_LLM_URL || "http://192.168.100.207:8080/v1/chat/completions";
  const model = process.env.WIKI_LLM_MODEL || "Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf";
  const apiKey = process.env.WIKI_LLM_API_KEY || "sk-no-key-required";
  const maxTokens = parseInt(process.env.WIKI_LLM_MAX_TOKENS || "4096", 10);
  const timeoutMs = parseInt(process.env.WIKI_LLM_TIMEOUT_MS || "120000", 10);
  const sessionId = process.env.WIKI_SESSION_ID || `cli-${Date.now()}`;

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.2, max_tokens: maxTokens,
  });

  const start = Date.now();
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body, signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`);
  const data = await resp.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
  const text = data.choices?.[0]?.message?.content || "";
  const tokensIn = data.usage?.prompt_tokens || (systemPrompt.length + userContent.length) / 4;
  const tokensOut = data.usage?.completion_tokens || text.length / 4;

  // Record metric
  try {
    const client = getClient(join(process.cwd(), ".codebase-wiki/rag_db"));
    await client.connect();
    await client.addMetric({
      id: `llm-${Date.now()}`,
      sessionId,
      source: "cli",
      tool: "discover--llm",
      tokensIn: Math.round(tokensIn),
      tokensOut: Math.round(tokensOut),
      durationMs: Date.now() - start,
      timestamp: Date.now(),
    });
  } catch { /* fail-open */ }

  return { text, tokensIn: Math.round(tokensIn), tokensOut: Math.round(tokensOut) };
}

// Phase 1: Generate full wiki documentation
async function phaseGenerateDoc(
  svcName: string, svcPath: string, serviceInfo: string, fileContext: string, astContext: string,
): Promise<number> {
  const prompt = `You are a Principal Software Architect. Analyze the service below and produce a comprehensive architectural wiki document.

  Required sections (use ## headings):
  - Overview (what it is, problem solved, tech stack)
  - Architecture (system context as ASCII diagram or text, design patterns, auth flow)
  - API Endpoints (complete table: Method | Path | Purpose)
  - Data Model (key types, entities, database schema)
  - Configuration (env vars grouped by category: public, server-only, secrets)
  - Dependencies (external services called + internal services that call this one)
  - Deployment (how deployed, container/base image, manifests location, CI/CD)
  - Testing (framework, test command, file patterns)
  - Gotchas (non-obvious behaviors, quirks, edge cases, conventions to follow when modifying)

  Rules:
  - Be specific with file paths (e.g. \`src/lib/oms/client.ts:45\`)
  - Use the source files and AST data provided — do NOT invent details
  - Target 4K+ chars of content
  - Output ONLY valid Markdown (no JSON wrapper, no explanations before/after)`;

  const context = `${serviceInfo}\n\n## Source Files\n${fileContext.slice(0, 12000)}\n\n## AST Analysis\n${astContext}`;
  const { text: content } = await callLLM(prompt, context);
  if (!content || content.length < 200) return 0;

  const client = getClient(join(process.cwd(), ".codebase-wiki/rag_db"));
  await client.connect();
  await client.indexDoc({
    id: svcName, serviceName: svcName, servicePath: svcPath,
    language: "unknown", sections: {}, content, indexedAt: Date.now(),
  });
  return Math.floor(content.length / 1000);
}

// Phase 2: Generate complete flows with file references + state machines
async function phaseGenerateFlows(
  svcName: string, svcPath: string, serviceInfo: string, fileContext: string, astContext: string,
): Promise<number> {
  const client = getClient(join(process.cwd(), ".codebase-wiki/rag_db"));
  await client.connect();

  // Round 1: Sequence flows (happy path, error path, edge case)
  const seqPrompt = `You are a Principal Software Architect. Generate COMPLETE sequence flows for this service — each must show the FULL lifecycle, not a truncated snippet.

  For each flow, output a JSON object on its own line:
  {"name":"Flow Name","flow_type":"happy_path|error_path|edge_case|recovery","summary":"one line","keywords":"kw1,kw2,kw3","linked":"svc1,svc2","file_refs":"src/handler/checkout.go:45,src/service/order.go:120","events_emitted":"order.created,payment.intent_created","events_consumed":"payment.succeeded,shipping.label_generated","saga_id":"checkout-saga","content":"## Flow Name\\n\\n### Referenced Files\\n- src/handler/checkout.go:45 — validation\\n- src/service/order.go:120 — order creation\\n\\n### Events Emitted\\n- order.created — when order is persisted\\n- payment.intent_created — when payment intent is registered\\n\\n### Events Consumed\\n- payment.succeeded — from payment-microservice\\n\\n### Summary\\n...\\n\\n\`\`\`mermaid\\nsequenceDiagram\\n  actor User\\n  participant SVC as ${svcName}\\n  ...\\n\`\`\`"}

  REQUIREMENTS:
  - Generate 3 sequence flows: 1 happy path + 1 error path + 1 edge case or recovery
  - MINIMUM 8 interactions per Mermaid diagram (not just 3-4 steps)
  - "events_emitted" — comma-separated event names this flow publishes (e.g. "order.created,payment.intent_created")
  - "events_consumed" — comma-separated event names this flow subscribes to and reacts to
  - "saga_id" — if this flow is part of a multi-service saga (distributed transaction), assign a saga_id (e.g. "checkout-saga", "order-fulfillment"). All flows in the same saga must share the same saga_id. If standalone, leave empty.
  - "file_refs" MUST contain comma-separated file paths with line numbers, taken from the AST data or source files provided
  - Include accurate file references — use the file paths from the AST (e.g. "handler/checkout.go:45")  

- linked services MUST use actual service names from the source code, not invented names
  - Output ONLY JSON lines (one per flow, no markdown fences, no explanations)`;

  const seqContext = `${serviceInfo}\n\n## AST Data (use file paths+events from here)\n${astContext}\n\n## Source Files\n${fileContext.slice(0, 4000)}`;
  const { text: seqText } = await callLLM(seqPrompt, seqContext);

  let count = 0;
  if (seqText) {
    for (const line of seqText.split("\n")) {
      try {
        const obj = JSON.parse(line.trim());
        if (!obj.name || !obj.content) continue;
        await client.addFlow({
          id: `${svcName}_${obj.name}`, serviceName: svcName, servicePath: svcPath,
          flowName: obj.name, summary: obj.summary || "",
          keywords: (obj.keywords || "").split(",").map((k: string) => k.trim()).filter(Boolean),
          linkedServices: (obj.linked || "").split(",").map((s: string) => s.trim()).filter(Boolean),
          flowType: obj.flow_type || "happy_path",
          content: obj.content,
          fileRefs: (obj.file_refs || "").split(",").map((f: string) => f.trim()).filter(Boolean),
          eventsEmitted: (obj.events_emitted || "").split(",").map((e: string) => e.trim()).filter(Boolean),
          eventsConsumed: (obj.events_consumed || "").split(",").map((e: string) => e.trim()).filter(Boolean),
          sagaId: obj.saga_id || "",
          indexedAt: Date.now(),
        });
        count++;
      } catch { /* skip invalid lines */ }
    }
  }

  // Round 2: State machines (order lifecycle, payment states, etc.)
  const statePrompt = `You are a Principal Software Architect. Identify ALL state machines in this service — entity lifecycles, status transitions, workflow states.

  For each state machine, output a JSON object on its own line:
  {"name":"Order Lifecycle","flow_type":"state_machine","summary":"Complete state machine for order status transitions","keywords":"state,machine,order,lifecycle","linked":"","file_refs":"src/model/order.go:15,src/service/order.go:200","events_emitted":"order.status_changed","saga_id":"","content":"## Order Lifecycle\\n\\n### Referenced Files\\n- src/model/order.go:15 — status constants\\n- src/service/order.go:200 — transition logic\\n\\n### Summary\\nOrder progresses through: PENDING → PAYMENT_PENDING → PAID → FULFILLMENT_INIT → COMPLETED\\n\\n\`\`\`mermaid\\nstateDiagram-v2\\n  [*] --> pending\\n  pending --> payment_pending: payment created\\n  payment_pending --> paid: payment confirmed\\n  payment_pending --> cancelled: timeout / user cancel\\n  paid --> fulfillment_init: fulfillment starts\\n  fulfillment_init --> completed: all items shipped\\n  completed --> [*]\\n  cancelled --> [*]\\n\`\`\`"}

  CRITICAL — Mermaid v10.9 stateDiagram-v2 syntax rules (follow EXACTLY):
  1. State names: lowercase letters, digits, and underscores ONLY (snake_case). Never use CamelCase, PascalCase, spaces, or hyphens.
     - GOOD: pending, payment_pending, fulfilled, failed_retry
     - BAD: PENDING, PaymentPending, "Crash Loop", PodInitializing
  2. NO self-transitions (X --> X). If a state can loop, use a transition to [*] and back, or skip it.
  3. NO nested state blocks (\`state Outer { ... }\`). Flatten everything.
  4. NO note blocks (\`note right of\`, \`note left of\`). Put details in the Summary section instead.
  5. Minimum 4 states. Maximum 12 states (avoid cluttered diagrams).
  6. Every state except [*] must have at least one incoming AND one outgoing transition.
  7. Transition labels after colon: keep under 40 chars, single line, no commas.
  8. "file_refs" MUST contain the specific files + line numbers where states are defined.
  9. "events_emitted" — events emitted on state transitions (e.g. "order.status_changed,order.cancelled")
  10. Output ONLY JSON lines (one per state machine, no markdown fences, no explanations).`;

  const stateContext = `${serviceInfo}\n\n## AST Data\n${astContext}\n\n## Source Files (look for status enums, state constants, transition logic)\n${fileContext.slice(0, 6000)}`;
  const { text: stateText } = await callLLM(statePrompt, stateContext);

  if (stateText) {
    for (const line of stateText.split("\n")) {
      try {
        const obj = JSON.parse(line.trim());
        if (!obj.name || !obj.content) continue;
        await client.addFlow({
          id: `${svcName}_${obj.name}`, serviceName: svcName, servicePath: svcPath,
          flowName: obj.name, summary: obj.summary || "",
          keywords: (obj.keywords || "").split(",").map((k: string) => k.trim()).filter(Boolean),
          linkedServices: (obj.linked || "").split(",").map((s: string) => s.trim()).filter(Boolean),
          flowType: "state_machine",
          content: obj.content,
          fileRefs: (obj.file_refs || "").split(",").map((f: string) => f.trim()).filter(Boolean),
          eventsEmitted: (obj.events_emitted || "").split(",").map((e: string) => e.trim()).filter(Boolean),
          eventsConsumed: [],
          sagaId: obj.saga_id || "",
          indexedAt: Date.now(),
        });
        count++;
      } catch { /* skip invalid lines */ }
    }
  }

  return count;
}

// Phase 3: Generate notes (patterns, gotchas, conventions)
async function phaseGenerateNotes(
  svcName: string, svcPath: string, serviceInfo: string, fileContext: string, astContext: string,
): Promise<number> {
  const prompt = `You are a Principal Software Architect. After analyzing a service, identify concrete patterns, gotchas, and conventions.

  For each discovery, output a JSON object on its own line:
  {"note_type":"pattern|gotcha|convention|integration|decision|tip","topic":"Short descriptive title","content":"What was discovered, why it matters, how it's used","context":"specific/file/path.ts","tags":"tag1,tag2,tag3"}

  REQUIREMENTS:
  - Generate at least 4 notes: 1 pattern + 1 gotcha + 1 convention + 1 of any type
  - "pattern" = a recurring design used in 2+ places in this service
  - "gotcha" = an edge case, unexpected behavior, or limitation
  - "convention" = a naming, structural, or code-style rule
  - context MUST be a specific file path with optional line number (e.g. "src/handler/auth.go:42")
  - tags must be 2-5 comma-separated lowercase keywords
  - Output ONLY JSON lines (no markdown fences, no explanations)`;

  const context = `${serviceInfo}\n\n## Source Files\n${fileContext.slice(0, 8000)}\n\n## AST Analysis\n${astContext}`;
  const { text } = await callLLM(prompt, context);
  if (!text) return 0;

  const client = getClient(join(process.cwd(), ".codebase-wiki/rag_db"));
  await client.connect();
  let count = 0;

  for (const line of text.split("\n")) {
    try {
      const obj = JSON.parse(line.trim());
      if (!obj.topic || !obj.content) continue;
      await client.addNote({
        id: `${svcName}_${obj.topic}_${Date.now()}`,
        type: obj.note_type || "tip",
        topic: obj.topic, content: obj.content,
        context: obj.context || "",
        tags: (obj.tags || "").split(",").map((t: string) => t.trim()),
        authoredBy: "llm-discover", authoredAt: Date.now(),
      });
      count++;
    } catch { /* skip invalid lines */ }
  }
  return count;
}

program.parse();
