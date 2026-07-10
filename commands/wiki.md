---
description: Generate, enhance, and query LLM-powered architectural documentation for any repository
---

Builds an architectural knowledge base by having AI agents discover services, generate comprehensive documentation, and index it for semantic search via MCP tools.

## Commands

```
/wiki generate <service-path>   → Agent discovers service, generates docs, indexes via MCP
/wiki generate-all               → Generate docs for all services in the repo
/wiki enhance <service> [flow] [full-deps]  → Add Mermaid C2/C3/sequence diagrams to existing doc
/wiki search <query>             → Search indexed docs by keyword
/wiki get <service>              → Retrieve full doc for a service
/wiki list                       → List all indexed services
/wiki stats                      → Knowledge base statistics
```

## CLI — Deep Discovery (`codebase-wiki discover --llm`)

Runs a 3-phase LLM pipeline per service — each phase has its own focused prompt and output type.

```
codebase-wiki discover          → AST scan: extract APIs, models, events, build graph
codebase-wiki discover --llm    → AST scan + 3-phase LLM discovery per service
```

**3-phase pipeline per service:**

| Phase | Focus | Output | LLM tokens |
|-------|-------|--------|:---:|
| 1 📖 | Wiki docs | Full markdown with 9 sections (Overview, Architecture, API Endpoints, Data Model, Configuration, Dependencies, Deployment, Testing, Gotchas) | ~4K |
| 2 🔄 | Flows | 4+ JSON lines: Mermaid sequence diagrams (happy path, error path, edge case, recovery) | ~4K |
| 3 💡 | Notes | 4+ JSON lines: patterns, gotchas, conventions with specific file paths | ~4K |

**LLM configuration via env vars:**

| Var | Default | Purpose |
|-----|---------|---------|
| `WIKI_LLM_URL` | `http://192.168.100.207:8080/v1/chat/completions` | OpenAI-compatible endpoint |
| `WIKI_LLM_MODEL` | `Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf` | Model name |
| `WIKI_LLM_API_KEY` | `sk-no-key-required` | Auth bearer token |
| `WIKI_LLM_MAX_TOKENS` | `4096` | Max tokens per LLM call |
| `WIKI_LLM_TIMEOUT_MS` | `120000` | Per-call timeout in ms |

**Language-agnostic file discovery:**

`readServiceFiles()` auto-detects relevant files based on the service's detected language:

| Language | Config pattern | Entry points checked |
|----------|---------------|---------------------|
| Go | `go.mod` | `cmd/server/main.go`, `cmd/main.go`, `main.go` |
| TypeScript | `package.json`, `tsconfig.json` | `src/index.ts`, `src/app/layout.tsx`, `src/main.ts` |
| Python | `pyproject.toml`, `setup.py`, `requirements.txt` | `main.py`, `app.py`, `__main__.py` |
| Rust | `Cargo.toml` | `src/main.rs` |
| Kotlin | `build.gradle.kts`, `build.gradle` | — |
| Java | `pom.xml`, `build.gradle.kts` | — |
| C#, Ruby, PHP, Elixir, Swift | Language-specific | Language-specific |
| Unknown | All common config files | All common entry points |

Also reads: README.md, AGENTS.md, .env files, Dockerfile, Makefile, CI/CD dirs — regardless of language.

Example with DeepSeek:
```bash
export WIKI_LLM_URL="https://api.deepseek.com/v1/chat/completions"
export WIKI_LLM_MODEL="deepseek-chat"
export WIKI_LLM_API_KEY="sk-..."
codebase-wiki discover --llm
```

## Enhance — Add Diagrams

`/wiki enhance <service> <flow> <full-deps?>`

The agent MUST follow this workflow:

1. **Read existing doc**: `wiki_get <service>`
2. **Generate diagrams using your LLM** with this prompt:
   - C3 Component Diagram: Mermaid flowchart of internal architecture (handlers→services→repos→clients)
   - Sequence Diagram: The `<flow>` lifecycle (entry→middleware→handler→service→repo→external calls)
   - Integration Map: All service connections, protocols, data flow direction
   - C2 Container Diagram (if `full-deps=true`): All services in the ecosystem + connections
3. **Append diagrams** to the end of the existing doc (do NOT remove existing text)
4. **Re-index**: `wiki_index` with the enhanced content

Examples:
```
/wiki enhance oms-microservice checkout true
/wiki enhance auth-microservice login
/wiki enhance callback-microservice webhook-delivery false  
```

## Notes

No credentials are hardcoded — the agent uses its own configured LLM.
All diagrams are Mermaid format, renderable in GitHub, Markdown, and the codebase-wiki UI.
