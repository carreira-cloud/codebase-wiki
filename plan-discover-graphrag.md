# Full Auto-Discovery + Watch Mode — Plan

## Two Core Changes to the Architecture

### 1. File References on Everything
Every entity (flow step, API, model, state machine transition) MUST reference the exact source file + line number. Makes the knowledge base actionable — from "checkout creates payment intent" you navigate to `order_service.go:142`.

### 2. GraphRAG Instead of Vector Store
Replace LanceDB with a typed graph (nodes + labeled edges). Enables queries like:
- "What flows does OMS have?" → traverse OMS → HAS_FLOW
- "Where is DeliveryPaymentMismatch handled?" → traverse FlowStep → REFERENCES → File
- "What depends on payment-microservice?" → reverse traverse DEPENDS_ON
- Graph queries are more natural for architecture than cosine similarity

---

## Graph Data Model

```
Nodes:                  Edges:
Service                 HAS_API        Service → API
  name, path, lang      HAS_MODEL      Service → Model
API                     HAS_FLOW       Service → Flow
  method, path,         DEPENDS_ON     Service → Service
  handler, file:line    STEP           Flow → FlowStep (ordered)
Model                   REFERENCES     FlowStep → File (file:line)
  name, fields,         CALLS          FlowStep → API (external)
  storage, file:line    TRIGGERS       Event → Flow
Flow                    COMPENSATES    Flow → Flow (rollback)
  name, type (happy/error/recovery/edge)
FlowStep
  order, action, sync/async, file:line
Event
  name, direction (inbound/outbound), protocol, file:line
File
  path, service, type (handler/service/model/middleware/config)
```

### Example: OMS Checkout Graph

```
oms-microservice
  HAS_API → POST /api/v1/orders/checkout [checkout_handler.go:42]
  HAS_MODEL → Order [order.go:5]
  HAS_FLOW → Checkout (happy_path)
    STEP 1 → Validate idempotency [order_service.go:82]
    STEP 2 → Create order (PENDING_OFFER) [order_service.go:95]
    STEP 3 → CreateQuote per item [order_service.go:110]
      CALLS → Niposom IAPC
    STEP 4 → CreatePaymentIntent [order_service.go:125]
      CALLS → payment-microservice POST /intents
    STEP 5 → Register subscription [order_service.go:138]
      CALLS → callback-microservice POST /events
    STEP 6 → Advance PAYMENT_PENDING [order_service.go:145]
    COMPENSATED_BY → cancelItemsBestEffort on failure

  HAS_FLOW → Fulfillment Retry (recovery)
    STEP 1 → Poll due orders (async, tick 1m) [fulfillment_retry_worker.go:15]
    STEP 2 → Claim lease [fulfillment_retry_worker.go:32]
    STEP 3 → Retry ConfirmOrder [fulfillment_retry_worker.go:48]
      SUCCESS → Complete + email
      FAILURE → schedule next retry or refund

  DEPENDS_ON → payment-microservice, callback-microservice, Niposom IAPC
  CONSUMES → payment.succeeded (inbound webhook) [webhook_handler.go:5]
```

---

## Discovery Pipeline

### Step 1: AST Scan — Extract Nodes with file:line

```
For each service:
  Parse source files → extract:
  - APIs: method, path, handler, auth, file:line
  - Models: name, fields, gorm/orm tags, file:line
  - Events: consumer functions, producer calls, file:line
  - Imports: all import paths for dependency graph
  - Config: env vars from config structs
```

### Step 2: LLM Analysis — Discover Flows + Connect Graph

Send AST nodes + selected source files to LLM:

```
You are analyzing oms-microservice.
Nodes extracted:
  APIs: [POST /checkout (42), GET /orders/:id (18), ...]
  Models: [Order (5), OrderItemFulfillment (12), Tenant (8)]
  Deps: [payment-microservice, callback-microservice, Niposom IAPC]
  Events: [payment.succeeded → webhook_handler.go:5]

TASK: For each major flow:
  1. Name + type (happy/error/recovery/edge)
  2. Ordered steps — each with:
     - Action description
     - File:line reference to the implementing code
     - sync/async flag
     - external dependency called (if any)
     - edge case branches
  3. Compensation/rollback → which flow?
  4. Event triggers → which event?
  5. Downstream flows triggered?
```

### Step 3: Build Graph

```
LLM output → parse into typed edges:
  HAS_FLOW (Service→Flow)
  STEP (Flow→FlowStep, ordered)
  REFERENCES (FlowStep→File with file:line)
  CALLS (FlowStep→API, when calling external)
  TRIGGERS (Event→Flow)
  COMPENSATES (Flow→Flow)
  DEPENDS_ON (Service→Service from imports)
```

### Step 4: Index as JSON

```
.codebase-wiki/graph/
  nodes.json   → all typed nodes with metadata
  edges.json   → all typed relationships
```

### Step 5: MCP Graph Query Tools

```
wiki_graph_query <start> <traversal>
  "START service:oms TRAVERSE HAS_FLOW"
  → flows with names and types

wiki_graph_trace <start> <end>
  "TRACE service:oms TO service:payment"
  → path with all intermediate steps

wiki_graph_impact <service> <depth>
  "IMPACT oms-microservice DEPTH 2"
  → downstream services + their flows

wiki_graph_file <file:line>
  "FILE order_service.go:125"
  → what flows/steps reference this location
```

---

## Watch Mode

```
codebase-wiki watch [--debounce 10]
```

On file change:
1. Identify affected service + file type (handler, service, model)
2. Re-run AST scan for changed files only
3. Re-run LLM only if flow-critical files changed (saga.go, handler.go, service.go)
4. Update graph: replace affected nodes + edges
5. If dependency changed, mark dependents as stale

**Staleness**: Each service has `lastIndexedAt`. `codebase-wiki check --stale` lists services with newer source files than their last index.

---

## Summary

```
codebase-wiki discover
  ├── AST Scan → nodes: APIs, Models, Events, Deps (with file:line)
  ├── LLM → edges: flows, steps, compensations, triggers (with file:line references)
  └── Graph store → nodes.json + edges.json + MCP query tools

codebase-wiki watch
  ├── File change → identify affected service
  ├── Incremental re-scan
  └── Conditional LLM re-analysis

MCP Tools:
  wiki_graph_query  → traverse graph by edge type
  wiki_graph_trace  → find paths between nodes
  wiki_graph_impact → blast radius analysis
  wiki_graph_file   → find references to a source location
```
