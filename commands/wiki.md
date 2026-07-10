---
description: Generate and query LLM-powered architectural documentation for any repository
---

Builds an architectural knowledge base by having AI agents discover services, generate comprehensive documentation, and index it for semantic search via MCP tools.

## Commands

```
/wiki generate <service-path>   → Agent discovers service, generates docs, indexes via MCP
/wiki generate-all               → Generate docs for all services in the repo
/wiki search <query>             → Search indexed docs by keyword
/wiki get <service>              → Retrieve full doc for a service
/wiki list                       → List all indexed services
/wiki stats                      → Knowledge base statistics
```

## Examples

```
/wiki generate microservices/oms-microservice
/wiki search "order lifecycle"
/wiki get oms-microservice
/wiki list
```

## MCP Integration

The codebase-wiki MCP server provides:
- `wiki_index` — store generated documentation
- `wiki_search` — search indexed docs
- `wiki_get` — retrieve a service's full doc
- `wiki_list` — list all indexed services
- `wiki_delete` — remove a service's doc

## Setup

```bash
npx @carreira-cloud/codebase-wiki init
npx @carreira-cloud/codebase-wiki start-mcp
```

Configure your agent's MCP to connect to this server.
