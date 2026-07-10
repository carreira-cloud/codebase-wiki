# Contributing to Codebase Wiki

## Adding a New Language Parser

1. Create a new file in `src/parser/` (e.g., `src/parser/rust-parser.ts`)
2. Implement the parser function:
```typescript
export function parseRustFile(filePath: string, content: string): Chunk[] {
  // Extract functions, structs, impls, traits...
  // Return array of Chunk objects
}
```
3. Register in `src/parser/registry.ts`:
```typescript
registerParser({
  language: "rust",
  extensions: [".rs"],
  parse: parseRustFile,
});
```
4. Add tests in `tests/unit/parser/`

## Development

```bash
git clone https://github.com/carreira-cloud/codebase-wiki
cd codebase-wiki
npm install
npm run build
npm test
```

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):
- `feat(parser): add Rust language parser`
- `fix(graph): handle circular imports gracefully`
- `docs(README): add MCP integration example`

## Testing

```bash
# Unit tests
bun test tests/unit/

# Integration tests (requires test fixtures)
bun test tests/integration/

# Full test with coverage
bun test --coverage
```

Test fixtures are in `tests/integration/fixtures/` — mini repos for each supported language.
