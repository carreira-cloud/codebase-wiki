# Skill: Codebase Wiki — Generate & Index

Generates comprehensive architectural documentation for services and indexes them into the knowledge base via MCP tools.

## Workflow

### `generate <service-path>`

The agent MUST follow this workflow:

1. **Discover**: Explore the service directory using `search_semantic`, `read`, `glob`
2. **Collect context**: Gather README, AGENTS.md, SKILLS.md, ARCHITECTURE.md, main entry points, go.mod/package.json, config files, Dockerfile
3. **Generate**: Using the gathered context, produce a comprehensive Markdown document with these sections:

```markdown
# <Service Name>

## Overview
Executive summary: what this service does, its role, language/framework, deployment model.

## Architecture
Internal architecture: pattern (layered, hexagonal, etc.), layers, design patterns, key components, directory structure.

## Data Model
Core entities, tables, schemas, key fields, relationships, storage engines, constraints, indexes.

## API / Endpoints
Public and internal endpoints: method, path, purpose, auth requirements, request/response shapes.

## Data Flow
Key operation lifecycles: entry point → middleware → handler → service → repository → external calls. Sync and async flows, sagas, retries, rollbacks.

## Integration Points
Every integration with other services, databases, brokers, external APIs. Protocol, data exchanged, auth, failure handling.

## Error Handling & Resilience
Error types, structured responses, logging, retries, circuit breakers, health checks, SLOs.

## Security
Auth (JWT, API keys, OAuth), RBAC, tenant isolation, encryption, input validation, secret management.

## Configuration
All env vars and config files: name, purpose, default, required/optional.
```

4. **Index**: Call the MCP tool `wiki_index` with the generated content:

```
Call tool `wiki_index` with:
  service_name: <service-name>
  service_path: <relative-path>
  language: <go|typescript|python|kotlin|...>
  content: <full markdown>
  sections: {
    "overview": "...",
    "architecture": "...",
    "dataModel": "...",
    "apiEndpoints": "...",
    "dataFlow": "...",
    "integrationPoints": "...",
    "errorHandling": "...",
    "security": "...",
    "configuration": "..."
  }
```

### `generate-all`

Discover all services in the repo and generate docs for each one. Use `wiki_list` after each to verify.

## Indexing (post-generation)

After ALL docs are generated, run:
```
npx codebase-wiki stats
```

To verify the knowledge base.

## Querying the Knowledge Base

During planning or debugging, use:
```
/wiki search <query>     → Find services matching a concept
/wiki get <service>      → Read full documentation
/wiki list               → See all indexed services
/wiki notes-search <q>   → Find discovered patterns, gotchas, conventions
/wiki notes-list [type]  → List all agent notes (optional type filter)
```

Or via MCP tools: `wiki_search`, `wiki_get`, `wiki_list`, `wiki_notes_search`, `wiki_notes_list`.

## Self-Learning: Adding Discovery Notes

When the agent discovers something important during ANY task (not just documentation generation), it SHOULD store it as a self-learning note. This builds institutional knowledge across sessions.

**When to add a note:**
- **pattern**: Recurring architectural pattern used across services
- **gotcha**: A tricky behavior, edge case, or undocumented behavior
- **integration**: How two services connect that wasn't documented
- **convention**: A coding convention, naming pattern, or project rule
- **decision**: Why a decision was made (ADR-style, but lightweight)
- **tip**: A shortcut, useful command, or workflow optimization

**How to add a note (via MCP tool `wiki_note`):**
```
Call tool `wiki_note` with:
  type: "gotcha" | "pattern" | "integration" | "convention" | "decision" | "tip"
  topic: Short summary (e.g., "Cart TTL is 24h, not configurable at runtime")
  content: Full explanation of the discovery
  context: Where this was found (file paths, service, scenario)
  tags: "cart,redis,ttl,configuration"
```

**Before starting work**, always query existing notes:
```
wiki_notes_search "<feature keyword>"   → Check if agents already discovered something relevant
wiki_notes_list "gotcha"                → Check for known gotchas in the affected area
```
