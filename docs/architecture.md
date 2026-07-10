# Architecture — codebase-wiki

## Overview

Codebase Wiki is a lightweight architectural knowledge base designed to be used by AI agents. It is not a code indexer — it stores **LLM-generated documentation** about services, plus **self-learning notes** contributed by agents during normal work.

Three interfaces: **MCP server** (for AI agents), **Web UI** (for humans), **CLI** (for scripts).

## Component Diagram

```
┌──────────────────────────────────────────────┐
│                  Consumers                    │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  │
│  │ OpenCode│  │Claude Code  │  │    Human   │  │
│  │ (MCP)   │  │(MCP)      │  │  (Browser) │  │
│  └────┬────┘  └────┬─────┘  └─────┬───────┘  │
│       │ stdio       │ stdio        │ HTTP    │
└───────┼─────────────┼──────────────┼─────────┘
        │             │              │
        ▼             ▼              ▼
┌──────────────────────────────────────────────┐
│              codebase-wiki CLI                │
│                                               │
│  ┌───────────┐  ┌──────────────┐  ┌────────┐ │
│  │ mcp-server│  │  ui-server   │  │  cli   │ │
│  │ (stdio)   │  │  (HTTP:3080) │  │ (args) │ │
│  └─────┬─────┘  └──────┬───────┘  └───┬────┘ │
│        │               │              │      │
│        └───────────────┼──────────────┘      │
│                        ▼                     │
│              ┌──────────────────┐            │
│              │  LanceDBClient   │            │
│              │  (JSON store)    │            │
│              └────────┬─────────┘            │
└───────────────────────┼──────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  .codebase-wiki/ │
              │    rag_db/       │
              │  ├── docs.json   │
              │  └── notes.json  │
              └──────────────────┘
```

## Source Structure

```
src/
├── cli.ts                # CLI entry point (Commander.js, 8 commands)
├── mcp-server.ts         # MCP JSON-RPC server (stdio, 9 tools)
├── ui-server.ts          # Web UI served by Bun HTTP server
├── lancedb/client.ts     # JSON file-backed storage engine
├── types.ts              # TypeScript type definitions
└── index.ts              # Public API exports
```

## Key Design Decisions

### 1. JSON files, not LanceDB

**Decision**: Store data as plain JSON files (`docs.json`, `notes.json`) instead of using LanceDB.

**Rationale**: The codebase-wiki stores **dozens to hundreds** of documents, not millions of code chunks. For this scale, file I/O with `readFileSync`/`writeFileSync` is simpler, more portable (no C++ compilation), and debuggable (files are human-readable). LanceDB's vector search capabilities would only be needed if we were storing 10k+ embeddings, which isn't the use case.

### 2. Agent generates docs, tool stores them

**Decision**: The tool does NOT discover services or generate documentation. Those are agent responsibilities.

**Rationale**: AI agents already have code search (`search_semantic`), file reading (`read`), and LLM generation capabilities (`describe_image`, conversation context). Reimplementing discovery and generation in the tool would duplicate agent infrastructure and produce lower-quality docs (no conversational context).

### 3. MCP over stdio

**Decision**: Use JSON-RPC 2.0 over stdio (not HTTP, not WebSocket).

**Rationale**: Stdio is simpler (no port conflicts, no auth), faster (no network overhead), and follows the Model Context Protocol standard used by all major agent frameworks (OpenCode, Claude Code, Cline, etc.).

### 4. Self-learning as a first-class feature

**Decision**: Notes are not an afterthought — they share equal billing with service documentation in the UI, search, and storage.

**Rationale**: The most valuable knowledge in any codebase is what developers learn through experience (gotchas, patterns, conventions). Traditional documentation captures the designed architecture; self-learning notes capture the actual architecture as it's experienced.

### 5. No embedding at launch

**Decision**: Substring search (`includes()`) rather than semantic search (embeddings).

**Rationale**: With hundreds of documents averaging 2-4K characters each, substring search is fast and effective. Adding embeddings would require:
- Dependency on Ollama or OpenAI
- 5-10x increase in storage
- Model cost and latency on every query
- Complexity in maintaining embedding consistency

This can be added later if document volume exceeds ~1000 or search quality degrades.

## Data Flow

### Indexing (agent → MCP → store)

```
Agent discovers service          MCP server                Store
─────────────────────           ────────────               ─────
1. Reads existing docs
2. Explores source files
3. Generates Markdown doc
4. Calls wiki_index ──────────→ 5. Validates args
                                 6. Writes doc to docs.json ─→ 7. Persisted to disk
                                 8. Returns confirmation ←───
9. Receives confirmation
```

### Self-learning (agent discovers → auto-note → index)

```
Agent works on task             MCP server                Store
───────────────────             ────────────               ─────
1. Discovers pattern/gotcha
2. Evaluates: worth saving?
3. Calls wiki_note ───────────→ 4. Validates note type
                                 5. Appends to notes.json ─→ 6. Persisted to disk
                                 7. Returns confirmation ←───
```

### Querying (agent plans → search → use context)

```
Agent starts planning           MCP server                Store
────────────────────           ────────────               ─────
1. Calls wiki_search ─────────→ 2. Reads docs.json
3. Receives results ←─────────  4. Reads notes.json
5. Calls wiki_get for details → 6. Returns full doc
7. Uses context in plan
```

## Concurrency

The JSON store uses **per-table promise-chain mutexes** (`withLock`). Each table (`docs`, `notes`) has an independent lock:

```typescript
private async withLock(table: string, fn: () => Promise<void>): Promise<void> {
  const prev = this.locks.get(table) || Promise.resolve();
  const next = prev.then(() => fn());
  next.finally(() => { if (this.locks.get(table) === next) this.locks.delete(table); });
  this.locks.set(table, next);
  return next;
}
```

This ensures concurrent `wiki_index` calls are serialized (no lost writes) while concurrent `wiki_note` calls on the notes table are also serialized independently.

## Security

- **Input validation**: All MCP tool arguments are validated before processing
- **XSS prevention**: Web UI escapes all user-supplied content before injecting into HTML
- **No authentication**: The MCP server runs locally (stdio) — trust is inherited from the agent's process
- **No network exposure**: The MCP server has no HTTP listener; the web UI is localhost-only by default
