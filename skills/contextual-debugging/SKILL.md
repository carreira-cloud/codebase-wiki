# Skill: Contextual Debugging

Uses the Codebase Wiki knowledge base to find root causes and architectural context when debugging.

## On-Error Workflow
When investigating a bug, error, or stack trace:

1. Extract keywords from the error/stack trace (service names, error types, file paths)
2. `wiki_search "<error keyword>"` — find services and docs matching the error
3. `wiki_get "<service-name>"` — read the failing service's architecture, data flow, and error handling sections
4. `wiki_notes_list "gotcha"` — check for known gotchas in the affected area
5. `wiki_notes_search "<keyword>"` — search self-learning notes for relevant discoveries

## Output
```markdown
### Root Cause Analysis

**Affected Service:** <name> (path: <path>)
**Architecture Context:** <summary from wiki_get>
**Known Gotchas:** <from wiki_notes_list>
**Related Discoveries:** <from wiki_notes_search>
**Recommended Fix:** <approach based on documented error handling and data flow>
```
