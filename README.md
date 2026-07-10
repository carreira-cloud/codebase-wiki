# Codebase Wiki

**Architectural knowledge base with MCP interface for AI agents.**

Agents discover services, generate LLM-powered docs with Mermaid C2/C3/sequence diagrams, and index them for semantic search. Includes self-learning notes and first-class workflow/flow indexing.

## Quick Start

```bash
npm install -g @carreira-cloud/codebase-wiki

cd my-project
codebase-wiki init              # Initialize knowledge base
codebase-wiki serve             # Browse at http://localhost:3080
codebase-wiki start-mcp         # Start MCP server for AI agents
```

## Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize knowledge base for current repo |
| `serve` | Start web UI (markdown + mermaid rendering, flows tab) |
| `start-mcp` | Start MCP server (stdio JSON-RPC, 12 tools) |
| `search <query>` | Search docs, notes, and flows by keyword |
| `get <service>` | Retrieve full documentation for a service |
| `list` | List all indexed services |
| `stats` | Statistics: services, flows, notes, content size |
| `install-opencode` | Install OpenCode skills and commands |

## MCP Tools

### Documentation (8 tools)
| Tool | Description |
|------|-------------|
| `wiki_index` | Index an LLM-generated architectural document |
| `wiki_search` | Search documentation by keyword |
| `wiki_get` | Retrieve full documentation for a service |
| `wiki_list` | List all indexed services |
| `wiki_delete` | Remove a service's documentation |
| `wiki_stats` | Statistics: services, content size, notes count, flows count |

### Self-Learning Notes (3 tools)
| Tool | Description |
|------|-------------|
| `wiki_note` | Store a self-learning discovery note |
| `wiki_notes_search` | Search agent notes by keyword |
| `wiki_notes_list` | List notes (optional type filter) |

### Workflows & Flows (3 tools)
| Tool | Description |
|------|-------------|
| `wiki_flow_index` | Index a workflow diagram with keywords and linked services |
| `wiki_flow_search` | Search flows across all services by keyword |
| `wiki_flow_list` | List flows (optional service/flow_type filter) |

## OpenCode Commands

```
/wiki generate <service>       → Agent discovers, generates docs, indexes via MCP
/wiki generate-all              → Generate docs for all services
/wiki enhance <service> <flow>  → Add Mermaid C3/C2/sequence diagrams
/wiki discover-flows <service>  → Discover and index all workflows with edge cases
/wiki flow-search <query>       → Search flows across all services
/wiki flow-list <service>       → List flows for a service
/wiki search <query>            → Search docs + notes + flows
/wiki get <service>             → Retrieve full doc
/wiki list                      → List all indexed services
/wiki stats                     → Knowledge base statistics
```

## Self-Learning

Agents automatically add notes when they discover something new. Six note types:

| Type | Trigger |
|------|---------|
| `gotcha` | Unexpected behavior, edge case, known bug |
| `pattern` | Recurring pattern across 2+ services |
| `integration` | Undocumented service integration detail |
| `convention` | Code convention, naming pattern |
| `decision` | Design decision (lightweight ADR) |
| `tip` | Shortcut, useful command, workflow hack |

## Flows & Diagrams

Each flow is independently indexed with:
- **Mermaid sequence diagram** (happy path + error paths + edge cases)
- **Keywords** for discoverability
- **Linked services** for cross-service navigation
- **Flow type**: happy_path, error_path, edge_case, recovery, full

Diagrams render in the web UI via Mermaid.js. The UI also renders service documentation markdown (tables, code blocks, headings) via marked.js.

## Architecture

```
src/
├── cli.ts              # CLI entry (8 commands)
├── mcp-server.ts       # MCP JSON-RPC server (12 tools)
├── ui-server.ts        # Web UI (marked.js + mermaid.js, flows tab)
├── lancedb/client.ts   # JSON file-backed storage (docs, notes, flows)
├── types.ts            # TypeScript types
└── index.ts            # Public API exports

docs/
├── getting-started.md
├── mcp-tools.md
├── self-learning.md
├── configuration.md
└── architecture.md
```

Storage: `.codebase-wiki/rag_db/docs.json` + `notes.json` + `flows.json`

## License

MIT — [Bruno Carreira](https://github.com/bruno-carreira)
