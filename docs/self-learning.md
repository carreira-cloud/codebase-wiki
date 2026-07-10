# Self-Learning System

The Codebase Wiki includes a self-learning mechanism where AI agents automatically store discoveries as structured notes. These notes accumulate across sessions, building institutional knowledge that future agents can query.

## How It Works

1. **Agent discovers something** during normal work (planning, debugging, implementing)
2. **Agent evaluates**: "Is this new knowledge worth preserving?"
3. **Agent calls `wiki_note`** via MCP — no human intervention needed
4. **Future agents query** notes before starting similar work

## Note Types

| Type | Icon | When to use | Example |
|------|------|-------------|---------|
| `gotcha` | 🔴 | Unexpected behavior, edge case, known bug, limitation | "Cart TTL is 24h and not configurable at runtime" |
| `pattern` | 🟣 | Recurring architectural pattern across 2+ services | "All Go services use Gin + GORM + Redis + logrus" |
| `integration` | 🔵 | Undocumented service integration detail | "OMS calls callback-microservice via POST /events for order status changes" |
| `convention` | 🟢 | Code convention, naming rule, implicit project rule | "Error messages in Portuguese for pt-PT tenant, English otherwise" |
| `decision` | 🟡 | Design decision with rationale (lightweight ADR) | "Chose MariaDB over PostgreSQL for auth-microservice because of existing Niposom infra" |
| `tip` | ⚪ | Shortcut, useful command, workflow optimization | "Run `go test -count=1 ./...` to bypass test cache when debugging flaky tests" |

## Agent Integration

### When to add a note

After completing any task, the agent evaluates:

```
Did I discover something that:
- Was surprising or unexpected?
- Is a recurring pattern I've seen before?
- Involves an integration not in the docs?
- Required a design tradeoff?
- Would save me time next time?
→ If yes to any: call wiki_note
```

### OpenCode rules

The `.opencode/rules/codebase_wiki_rules.md` file mandates:

```
Após QUALQUER tarefa, o agente avalia o que aprendeu de novo.
Se algo relevante foi descoberto, DEVE registar via wiki_note.
```

### Example: Agent debug session

```
1. Agent receives: "Bug: cart expires prematurely"
2. Agent calls: wiki_search "cart expiration"
3. Agent calls: wiki_notes_search "cart" → finds gotcha about TTL
4. Agent fixes the bug (CART_TTL_SECONDS was misspelled)
5. Agent discovers: "camelCase vs UPPER_CASE env vars are not interchangeable in Viper"
6. Agent calls: wiki_note(type="gotcha", topic="Viper env var case sensitivity",
     content="Viper maps UPPER_CASE env vars but GORM/some libs expect camelCase.
              Misspelled CART_TTL_SECONDS silently falls back to default 86400.",
     context="cart-microservice/internal/config/config.go",
     tags="viper,env,case-sensitivity,gotcha")
7. Agent completes: bug fixed + knowledge preserved
```

## Querying Notes

### Before starting work

```
wiki_notes_list "gotcha"              → All known gotchas
wiki_notes_search "<keyword>"         → Notes matching a concept
wiki_notes_list "pattern"             → Discovered patterns
```

### From the web UI

`codebase-wiki serve` → Notes tab shows all notes with type badges, content snippets, context paths, and tags.

## Storage

Notes are stored in `.codebase-wiki/rag_db/notes.json`:

```json
[
  {
    "id": "a1b2c3d4e5f6",
    "type": "gotcha",
    "topic": "Cart TTL is hardcoded to 24h",
    "content": "...",
    "context": "microservices/cart-microservice/internal/config/config.go:42",
    "tags": ["cart", "redis", "ttl", "configuration", "gotcha"],
    "authored_by": "agent",
    "authored_at": 1700000000000
  }
]
```

## Best Practices

1. **Be specific**: "Cart TTL is 24h" not "Cart has TTL issues"
2. **Include context**: File paths and line numbers help future agents
3. **Tag generously**: Tags are the primary discovery mechanism
4. **Don't over-note**: Only genuinely useful discoveries — not "I imported fmt"
5. **Review occasionally**: /wiki notes-list → prune outdated or wrong notes
6. **Deduplicate**: If a note already exists on the same topic, don't create a duplicate
