# MCP Tools Reference

The codebase-wiki MCP server exposes 9 tools via stdio JSON-RPC 2.0.

## Server Protocol

```
Client → Server: JSON-RPC 2.0 request (one per line)
Server → Client: JSON-RPC 2.0 response (one per line)
```

Supported methods: `initialize`, `tools/list`, `tools/call`.

## Tools

### `wiki_index`

Index architectural documentation for a service.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "wiki_index",
    "arguments": {
      "service_name": "oms-microservice",
      "service_path": "microservices/oms-microservice",
      "language": "go",
      "content": "# oms-microservice\n\n## Overview\n...",
      "sections": {
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
    }
  }
}
```

**Parameters:**
| Field | Required | Description |
|-------|----------|-------------|
| `service_name` | Yes | Service/package name |
| `service_path` | No | Relative path in repo |
| `language` | No | Primary language (go, typescript, python, etc.) |
| `content` | Yes | Full Markdown documentation |
| `sections` | No | Key-value of section name → content |

**Response:**
```json
{
  "result": {
    "content": [{
      "type": "text",
      "text": "Documentation indexed for \"oms-microservice\" (4K chars)"
    }]
  }
}
```

---

### `wiki_search`

Search documentation by keyword (matches service name and content).

```json
{
  "method": "tools/call",
  "params": {
    "name": "wiki_search",
    "arguments": { "query": "order lifecycle" }
  }
}
```

**Response:**
```json
{
  "result": {
    "content": [{
      "type": "text",
      "text": "[\n  {\n    \"name\": \"oms-microservice\",\n    \"path\": \"microservices/oms-microservice\",\n    \"preview\": \"The OMS (Order Management System) microservice...\"\n  }\n]"
    }]
  }
}
```

Returns up to 10 results, ranked by match relevance (substring match on service name or content).

---

### `wiki_get`

Retrieve full documentation for a service.

```json
{
  "method": "tools/call",
  "params": {
    "name": "wiki_get",
    "arguments": { "service_name": "oms-microservice" }
  }
}
```

**Response:** Full Markdown content as text. Returns `"No documentation found for \"...\""` if not indexed.

---

### `wiki_list`

List all services with indexed documentation.

```json
{
  "method": "tools/call",
  "params": { "name": "wiki_list", "arguments": {} }
}
```

**Response:**
```json
[
  { "name": "oms-microservice", "path": "microservices/oms-microservice", "size": 4218 },
  { "name": "auth-microservice", "path": "microservices/auth-microservice", "size": 3800 }
]
```

---

### `wiki_delete`

Remove a service's documentation.

```json
{
  "method": "tools/call",
  "params": {
    "name": "wiki_delete",
    "arguments": { "service_name": "old-service" }
  }
}
```

---

### `wiki_stats`

Knowledge base statistics.

```json
{
  "method": "tools/call",
  "params": { "name": "wiki_stats", "arguments": {} }
}
```

**Response:** `"5 services indexed, 22K chars, 12 agent notes"`

---

### `wiki_note`

Store a self-learning discovery note.

```json
{
  "method": "tools/call",
  "params": {
    "name": "wiki_note",
    "arguments": {
      "type": "gotcha",
      "topic": "Cart TTL is hardcoded to 24h",
      "content": "The cart-microservice Redis TTL defaults to 86400 and cannot be changed at runtime. Must restart the pod with CART_TTL_SECONDS env var.",
      "context": "microservices/cart-microservice/internal/config/config.go",
      "tags": "cart,redis,ttl,configuration"
    }
  }
}
```

**Parameters:**
| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | One of: `gotcha`, `pattern`, `integration`, `convention`, `decision`, `tip` |
| `topic` | Yes | Short title summarizing the discovery |
| `content` | Yes | Full explanation |
| `context` | No | Where discovered (file paths, service) |
| `tags` | No | Comma-separated tags |

---

### `wiki_notes_search`

Search self-learning notes by keyword.

```json
{
  "method": "tools/call",
  "params": {
    "name": "wiki_notes_search",
    "arguments": { "query": "cart" }
  }
}
```

Searches across topic, content, tags, and context fields.

**Response:**
```json
[
  {
    "type": "gotcha",
    "topic": "Cart TTL is hardcoded to 24h",
    "snippet": "The cart-microservice Redis TTL defaults to...",
    "context": "microservices/cart-microservice/internal/config/config.go",
    "tags": ["cart", "redis", "ttl", "configuration"]
  }
]
```

---

### `wiki_notes_list`

List all notes, optionally filtered by type.

```json
{
  "method": "tools/call",
  "params": {
    "name": "wiki_notes_list",
    "arguments": { "type": "gotcha" }
  }
}
```

Omit `type` to list all notes.

## Error Handling

Tool errors return JSON-RPC error responses:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32000,
    "message": "Error description"
  }
}
```

Common errors:
- `-32700` — Parse error (malformed JSON)
- `-32601` — Unknown method
- `-32000` — Tool execution error (invalid arguments, missing service, etc.)
