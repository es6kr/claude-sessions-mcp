# claude-sessions-mcp

MCP (Model Context Protocol) server and Web UI for managing Claude Code sessions.

## Features

- **Project Listing**: Browse Claude Code project folders
- **Session Management**: List, rename, and delete sessions
- **Message Management**: View and delete messages within sessions
- **Cleanup**: Clear empty sessions and remove invalid API key messages
- **Web UI**: SvelteKit-based web interface

## Installation

```bash
# Using npx (recommended)
npx @es6kr/claude-sessions-mcp

# Or install globally
npm install -g @es6kr/claude-sessions-mcp
```

## Usage

### Claude Code MCP Integration

Add to Claude Code:

```bash
claude mcp add claude-sessions -- npx @es6kr/claude-sessions-mcp
```

Or manually edit `~/.claude.json`:

```json
{
  "mcpServers": {
    "claude-sessions": {
      "command": "npx",
      "args": ["@es6kr/claude-sessions-mcp"]
    }
  }
}
```

### Web GUI

Launch the web interface via MCP tool (from Claude Code):

```text
> Use the start_gui tool to launch web interface
```

The GUI opens at `http://localhost:5050` with features:

- Browse all projects and sessions
- View full conversation history
- Rename sessions with inline editing
- Delete unwanted sessions
- Bulk cleanup of empty sessions

## Development

```bash
# Enable corepack
corepack enable

# Install dependencies
pnpm install

# Start web development server
pnpm dev

# MCP server development mode
pnpm dev:mcp
```

## Build

```bash
pnpm build
```

## MCP Server Tools

### Available Tools

| Tool              | Description                               |
| ----------------- | ----------------------------------------- |
| `list_projects`   | List Claude Code projects                 |
| `list_sessions`   | List sessions in a project                |
| `rename_session`  | Rename a session                          |
| `delete_session`  | Delete a session (moves to backup folder) |
| `delete_message`  | Delete a message and repair UUID chain    |
| `preview_cleanup` | Preview sessions to be cleaned            |
| `clear_sessions`  | Clear empty sessions and invalid messages |
| `start_gui`       | Start the web UI                          |
| `stop_gui`        | Stop the web UI                           |

## Tech Stack

- **MCP Server**: Node.js + TypeScript + Effect
- **Web UI**: SvelteKit + Svelte 5
- **Build**: tsup (MCP), Vite (Web)
- **Package Manager**: pnpm (corepack)

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

## License

MIT
