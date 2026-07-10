# Codebase Wiki — Regras Operacionais

> Estas regras são instaladas em `.opencode/rules/codebase_wiki_rules.md` e carregadas
> automaticamente em cada sessão do OpenCode.

## 1. Consulta Obrigatória (antes de planear)

Antes de escrever specs, ADRs, ou planos de implementação:

1. `wiki_search "<feature name>"` — serviços e fluxos afectados
2. `wiki_get "<service-name>"` — documentação completa de cada serviço no blast radius
3. `wiki_flow_search "<keyword>"` — fluxos relevantes (happy paths, error paths, edge cases)
4. `wiki_notes_search "<termo>"` — aprendizagens anteriores relevantes
5. `wiki_notes_list "gotcha"` — gotchas conhecidos na área

## 2. Consulta Obrigatória (antes de debuggar)

Ao receber um stack trace, erro, ou descrição de bug:

1. `wiki_search "<error keyword>"` — mapear blast radius
2. `wiki_get "<service-name>"` — rever architecture, data flow, error handling
3. `wiki_flow_list "<service>"` — ver fluxos do serviço (especialmente error_path e edge_case)
4. `wiki_notes_list "gotcha"` — verificar gotchas conhecidos

## 3. Self-Learning — Automático

Após qualquer tarefa, avaliar o que foi aprendido e registar via `wiki_note`:

| Tipo | Trigger |
|------|---------|
| `gotcha` | Edge case, comportamento inesperado, limitação |
| `pattern` | Padrão recorrente em 2+ serviços |
| `integration` | Detalhe de integração não documentado |
| `convention` | Convenção de código, naming, regra implícita |
| `decision` | Decisão de design (ADR lightweight) |
| `tip` | Atalho, comando útil, workflow hack |

## 4. Manutenção do Knowledge Base

- **Gerar docs**: `/wiki generate <service-path>` — serviço novo ou após refactor estrutural
- **Adicionar diagramas**: `/wiki enhance <service> <flow>` — Mermaid C3 + sequence
- **Descobrir fluxos**: `/wiki discover-flows <service>` — indexar todos os workflows
- **Verificar cobertura**: `/wiki list` + `wiki_flow_list`
- **Explorar**: `codebase-wiki serve` → http://localhost:3080

## 5. Ferramentas MCP

| Tool | Descrição |
|------|-----------|
| `wiki_index` | Indexar documentação |
| `wiki_search` | Pesquisar documentação |
| `wiki_get` | Obter documentação completa |
| `wiki_list` | Listar serviços indexados |
| `wiki_delete` | Remover documentação |
| `wiki_stats` | Estatísticas |
| `wiki_note` | Registar nota de self-learning |
| `wiki_notes_search` | Pesquisar notas |
| `wiki_notes_list` | Listar notas |
| `wiki_flow_index` | Indexar workflow/sequence diagram |
| `wiki_flow_search` | Pesquisar fluxos |
| `wiki_flow_list` | Listar fluxos |
