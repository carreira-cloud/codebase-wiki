# Codebase Wiki

**Architectural knowledge base with MCP interface for AI agents.**

Auto-discovers services, generates LLM-powered documentation, and indexes it for semantic search. Agents query the wiki for planning and debugging, and contribute self-learning notes when they discover something new.

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
| `serve` | Start web UI to browse docs, notes, and search |
| `start-mcp` | Start MCP server (stdio JSON-RPC) for AI agents |
| `search <query>` | Search indexed documentation by keyword |
| `get <service>` | Retrieve full documentation for a service |
| `list` | List all indexed services |
| `stats` | Show knowledge base statistics |
| `install-opencode` | Install OpenCode skills and commands |

## MCP Tools

| Tool | Description |
|------|-------------|
| `wiki_index` | Index an LLM-generated architectural document |
| `wiki_search` | Search documentation by keyword |
| `wiki_get` | Retrieve full documentation for a service |
| `wiki_list` | List all indexed services |
| `wiki_delete` | Remove a service's documentation |
| `wiki_stats` | Statistics: services, content size, notes count |
| `wiki_note` | Store a self-learning discovery note |
| `wiki_notes_search` | Search agent notes by keyword |
| `wiki_notes_list` | List notes (optional type filter) |

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

## Architecture

```
src/
├── cli.ts              # CLI entry (8 commands)
├── mcp-server.ts       # MCP JSON-RPC server (9 tools)
├── ui-server.ts        # Web UI (single-page HTML app)
├── lancedb/client.ts   # JSON file-backed storage
├── types.ts            # TypeScript types
└── index.ts            # Public API exports
```

Storage: `.codebase-wiki/rag_db/docs.json` + `notes.json`

## License

MIT — [Bruno Carreira](https://github.com/bruno-carreira)
