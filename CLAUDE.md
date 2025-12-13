# CLAUDE.md

Guidelines for Claude Code when working with this repository.

## Project Overview

MCP server and Web UI for managing Claude Code sessions. Built with:

- **MCP Server**: Node.js + TypeScript + Effect-TS
- **Web UI**: SvelteKit + Svelte 5
- **Build**: tsup (MCP), Vite (Web)
- **Package Manager**: pnpm (corepack)

## Development Commands

```bash
# Enable corepack first
corepack enable

# Install dependencies
pnpm install

# Web development server
pnpm dev

# MCP server development
pnpm dev:mcp

# Build all
pnpm build
```

## Architecture

### MCP Server (`src/mcp/`)

- Entry point: `src/mcp/index.ts`
- Uses `@modelcontextprotocol/sdk` for MCP protocol
- Effect-TS for async operations

### Web UI (`web/`)

- SvelteKit with Svelte 5 runes (`$state`, `$derived`, `$props`)
- Server-side session management in `web/src/lib/server/session.ts`
- API routes in `web/src/routes/api/`

### Session Storage

- Sessions stored in `~/.claude/projects/` as JSONL files
- Folder naming: `-` = `/`, `--` = `/.` (dot-prefixed folders)
- Example: `-Users-david--claude` = `/Users/david/.claude`

## Effect-TS Patterns

This project uses [Effect](https://effect.website) for functional async operations:

```typescript
import { Effect, pipe, Array as A, Option as O } from 'effect'

// Define an Effect (lazy, composable)
const listProjects = Effect.gen(function* () {
  const files = yield* Effect.tryPromise(() => fs.readdir(dir))
  return files.filter((f) => f.endsWith('.jsonl'))
})

// Parallel execution with concurrency control
const results =
  yield *
  Effect.all(
    items.map((item) => processItem(item)),
    { concurrency: 10 }
  )

// Option for nullable values
const title = pipe(
  messages,
  A.findFirst((m) => m.type === 'user'),
  O.map((m) => extractTitle(m)),
  O.getOrElse(() => 'Untitled')
)

// Run in SvelteKit endpoint
export const GET = async () => {
  const result = await Effect.runPromise(listProjects)
  return json(result)
}
```

## Code Style

- TypeScript strict mode
- Effect-TS for async/error handling
- Svelte 5 runes for reactivity
- No emojis in code unless requested

## Release

버전 업데이트 및 태그 푸시:

```bash
npm version patch && git push && git push --tags
```

버전 타입:

- `patch`: 0.1.4 → 0.1.5 (버그 수정)
- `minor`: 0.1.4 → 0.2.0 (기능 추가)
- `major`: 0.1.4 → 1.0.0 (Breaking changes)

> `.npmrc`에 `sign-git-commit=true`, `sign-git-tag=true` 설정으로 자동 서명됨
