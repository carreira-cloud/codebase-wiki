#!/usr/bin/env node
import { Command } from "commander";
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { handleMCPRequest } from "./mcp-server";
import { getClient } from "./lancedb/client";
import { startUIServer } from "./ui-server";

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
    console.log(`\n📊 ${stats.services} services, ${Math.floor(stats.totalChars / 1000)}K chars\n`);
  });

program
  .command("install-opencode")
  .description("Install OpenCode skills & commands into .opencode/")
  .action(() => {
    const rootPath = process.cwd();
    const openCodeDir = join(rootPath, ".opencode");
    const skillsDir = join(openCodeDir, "skills");
    const commandsDir = join(openCodeDir, "commands");

    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(commandsDir, { recursive: true });

    const srcSkills = join(__dirname, "..", "skills");
    const srcCommands = join(__dirname, "..", "commands");

    if (existsSync(srcSkills)) copyDir(srcSkills, skillsDir);
    if (existsSync(srcCommands)) copyDir(srcCommands, commandsDir);

    console.log("\n✔ OpenCode skills and commands installed!");
    console.log("   Skills: .opencode/skills/architectural-planning/");
    console.log("   Commands: .opencode/commands/wiki.md");
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

program.parse();
