#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, watch } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { handleMCPRequest } from "./mcp-server";
import { getClient } from "./lancedb/client";
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
  .option("--llm", "Enable LLM flow discovery after AST scan (generates sequence diagrams)")
  .action(async (options: { llm?: boolean }) => {
    const rootPath = process.cwd();
    const dbPath = join(rootPath, ".codebase-wiki/rag_db");
    console.log("\n🔍 Full discovery scan...\n");
    const result = await discoverServices(rootPath, dbPath);
    console.log(`\n✔ Graph built: ${result.nodes} nodes, ${result.edges} edges`);
    console.log(`   ${result.services} services, ${result.apis} APIs, ${result.models} models, ${result.events} events`);

    if (options.llm) {
      console.log("\n🧠 LLM Flow Discovery...\n");
      const client = getClient(dbPath);
      await client.connect();
      const { nodes } = await client.loadGraph();
      const services = nodes.filter(n => n.type === "Service");

      for (const svc of services) {
        const svcName = svc.data.name as string;
        console.log(`   📝 ${svcName}...`);

        // Gather context: APIs + models for this service
        const svcApis = nodes.filter(n => n.type === "API" && (n.data.service as string) === svcName);
        const svcModels = nodes.filter(n => n.type === "Model" && (n.data.service as string) === svcName);
        const svcEvents = nodes.filter(n => n.type === "Event" && (n.data.service as string) === svcName);

        const context = `Service: ${svcName}
APIs:
${svcApis.map(a => `- ${a.data.method} ${a.data.path} (${a.data.fileRef})`).join("\n").slice(0, 2000)}

Models:
${svcModels.map(m => `- ${m.data.name} (${m.data.fileRef})`).join("\n").slice(0, 1500)}

${svcEvents.length > 0 ? `Events:\n${svcEvents.map(e => `- ${e.data.direction} ${e.data.name} (${e.data.fileRef})`).join("\n").slice(0, 1000)}` : ""}

Based on this structure, generate ALL major flows for this service.
For each flow, produce:
1. Name + type (happy_path, error_path, edge_case, recovery)
2. Brief summary
3. 3-7 comma-separated keywords
4. Comma-separated linked services
5. A Mermaid sequence diagram showing the flow with ALL steps`;

        try {
          const flowNames = await discoverFlowsWithLLM(svcName, context, dbPath, svc.data.path as string);
          console.log(`      ${flowNames} flows indexed`);
        } catch (e) {
          console.log(`      ⚠ ${String(e).slice(0, 80)}`);
        }
      }
      console.log(`\n✔ Flow discovery complete\n`);
    } else {
      console.log(`\n   (use --llm to enable automatic flow discovery)\n`);
    }
  });

program
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

function copyDir(src: string, dest: string): void {
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      if (!existsSync(destPath)) mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

async function discoverFlowsWithLLM(svcName: string, context: string, dbPath: string, svcPath: string): Promise<number> {
  const url = "http://192.168.100.207:8080/v1/chat/completions";
  const body = JSON.stringify({
    model: "Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf",
    messages: [
      { role: "system", content: `You are a Principal Software Architect analyzing a service to discover its workflows.
For each flow, output a JSON object (one per line, no wrapping array):
{"name":"Flow Name","type":"happy_path|error_path|edge_case|recovery","summary":"one line","keywords":"kw1,kw2,kw3","linked":"svc1,svc2","content":"## Flow Name\\n\\nSummary\\n\\n\`\`\`mermaid\\nsequenceDiagram\\n...\\n\`\`\`"}
Output ONLY valid JSON lines. No markdown, no explanations.` },
      { role: "user", content: context },
    ],
    temperature: 0.2, max_tokens: 4096,
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer sk-no-key-required" },
    body, signal: AbortSignal.timeout(120000),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content || "";

  const client = getClient(dbPath);
  await client.connect();
  let count = 0;

  for (const line of text.split("\n")) {
    try {
      const flow = JSON.parse(line.trim());
      if (!flow.name || !flow.content) continue;
      const id = `${svcName}_${flow.name}`;
      await client.addFlow({
        id, serviceName: svcName, servicePath: svcPath,
        flowName: flow.name, summary: flow.summary || "",
        keywords: (flow.keywords || "").split(",").map((k: string) => k.trim()).filter(Boolean),
        linkedServices: (flow.linked || "").split(",").map((s: string) => s.trim()).filter(Boolean),
        flowType: flow.type || "happy_path", content: flow.content, indexedAt: Date.now(),
      });
      count++;
    } catch { /* skip invalid JSON lines */ }
  }

  return count;
}

program.parse();
