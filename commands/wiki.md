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
