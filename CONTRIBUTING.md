# Contributing to claude-sessions-mcp

Thank you for contributing to the MCP server for Claude Code session management!

## Development Setup

### Requirements

- Node.js 22+
- pnpm 9.15.0 (managed via corepack)

### Installation

```bash
# Clone repository
git clone https://github.com/es6kr/claude-sessions-mcp.git
cd claude-sessions-mcp

# Install dependencies
pnpm install
```

## Code Style

### EditorConfig

Project uses `.editorconfig` settings:

- **Charset:** UTF-8
- **End of Line:** LF
- **Indent:** 2 spaces
- **Final newline:** Required
- **Trailing whitespace:** Trimmed (except markdown)

### ESLint & Prettier

- **ESLint:** Applied to TypeScript and Svelte files
- **Prettier:** Auto-formatting
  - Print width: 100
  - Semi: false (no semicolons)
  - Single quote: true
  - Tab width: 2
  - Trailing comma: es5

### Running Lint

```bash
# Lint check
pnpm lint

# Type check
pnpm typecheck
```

## Commit Convention

Follow **Conventional Commits** format:

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Types

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, semicolons, etc.)
- `refactor:` Code refactoring without functional changes
- `test:` Add/update tests
- `chore:` Build process, tooling changes
- `ci:` CI/CD pipeline changes
- `perf:` Performance improvements

### Scope Examples

- `mcp` - MCP server related
- `web` - Web UI related
- `session` - Session management logic

### Examples

```bash
feat(mcp): add session rename tool
fix(web): correct message display order
docs: update installation guide
```

## Pre-commit Hook

Husky and lint-staged are configured automatically:

- Prettier auto-formatting
- ESLint auto-fix
- EditorConfig validation

Runs automatically before commit, no manual execution needed.

## Build & Test

### MCP Server Development

```bash
# MCP server dev mode
pnpm dev:mcp

# MCP server build
pnpm build:mcp
```

### Web UI Development

```bash
# Web UI dev server
pnpm dev

# Web UI build
pnpm build:web
```

### Full Build

```bash
# Build both MCP + Web UI
pnpm build
```

## Project Structure

```
claude-sessions-mcp/
├── src/                 # MCP server source
│   ├── mcp/            # MCP server entrypoint
│   └── lib/            # Shared library
├── web/                 # Svelte Web UI
│   ├── src/
│   │   ├── lib/        # Components and utilities
│   │   └── routes/     # SvelteKit routes
│   └── package.json
├── dist/                # Build output
├── .editorconfig
├── eslint.config.js
├── package.json
└── tsup.config.ts
```

## Pull Request Guide

1. **Create branch:** `feat/your-feature` or `fix/your-fix`
2. **Write code:** Follow code style guidelines
3. **Commit:** Use Conventional Commits format
4. **Test:** Verify build succeeds
5. **Create PR:** Clearly describe changes

## License

MIT License - See LICENSE file for details.
