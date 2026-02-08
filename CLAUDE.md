# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Frontly is an AI-powered CLI tool for creating and editing React + Vite frontend projects. It uses Google's Gemini API to generate code through an interactive terminal chat interface built with Ink (React for CLIs).

## Build & Development Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Watch mode compilation
npm run start          # Run the CLI (node dist/cli.js)
npm run lint           # ESLint on src/**/*.{ts,tsx}
npm run clean          # Remove dist/
```

There is no test framework configured. No unit tests exist.

The CLI requires `GEMINI_API_KEY` env var to run.

## Architecture

### Entry Points

- `src/cli.ts` — Commander.js CLI setup. Two commands: default (interactive chat) and `test` (build+serve+browser test).

### Module Layout

| Directory | Purpose |
|-----------|---------|
| `src/ui/` | Ink React components: `App.tsx` (root state machine), `Chat.tsx` (message display), `Input.tsx` (single-line input with cursor) |
| `src/gemini/` | `client.ts` (Gemini API calls, response/plan parsing), `prompts.ts` (system prompt, prompt builders) |
| `src/repo/` | `scanner.ts` (detect React/Vite, build file tree), `summarizer.ts` (text summary for LLM context) |
| `src/fs/` | `writer.ts` (apply execution plans), `validator.ts` (TypeScript compiler API validation), `diff.ts` (diff generation) |
| `src/browser/` | `browserbase.ts` (Stagehand LOCAL mode for browser artifact collection) |
| `src/artifacts/` | `persist.ts` (save test artifacts to `.frontly/artifacts/TIMESTAMP/`) |
| `src/commands/` | `test.ts` (build, serve via execa, collect browser artifacts) |

### Core Data Flow

1. User message → `createPromptWithContext()` adds repo summary + chat history
2. Gemini responds with either plain text or a `` ```json:plan `` `` block containing an `ExecutionPlan`
3. App enters `confirm` mode → user approves (y/n)
4. On approval, Gemini is called per-file via `createFileContentPrompt()` to get raw file content
5. `writer.ts` applies changes, `validator.ts` checks TypeScript syntax (compiler API, not external linter)
6. If validation fails → `validation_failed` mode, user can override or cancel

### App Modes (state machine in App.tsx)

- `chat` — normal conversation
- `confirm` — execution plan presented, awaiting y/n
- `validation_failed` — code validation errors, confirm to override
- `applying` — plan execution in progress, UI frozen

### ExecutionPlan Schema

```typescript
{ reasoning: string; files_to_create: {path, description}[]; files_to_modify: {path, description}[]; files_to_delete: string[] }
```

## Code Conventions

- ES Modules throughout (`"type": "module"` in package.json, NodeNext module resolution)
- All local imports use `.js` extension (required by NodeNext)
- TypeScript strict mode enabled
- Functional React components with explicit prop types (not React.FC)
- Named exports over default exports
- Module-level functions over classes
- Core types defined in `src/types.ts`
- JSX uses `react-jsx` transform (no manual React import needed in JSX files)

## Validation Behavior

The TypeScript compiler API is used for file validation:
- Syntax errors are blocking (plan application fails)
- Semantic errors are treated as warnings
- "Cannot find module" and "Cannot find name" errors are skipped (incomplete project context)
