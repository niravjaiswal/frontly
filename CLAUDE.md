# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Frontly is an AI-powered CLI tool for creating and editing React + Vite frontend projects. It uses Google's Gemini API to generate code through an interactive terminal chat interface built with Ink (React for CLIs). It also includes a testing framework with AI-powered test discovery and deterministic test execution.

## Build & Development Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Watch mode compilation
npm run start          # Run the CLI (node dist/cli.js)
npm run lint           # ESLint on src/**/*.{ts,tsx}
npm run clean          # Remove dist/
```

There is no test framework configured. No unit tests exist.

### Environment Variables

- `GEMINI_API_KEY` — Required for the default chat command
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` — Required for the `discover` command (uses Stagehand with Claude 3.7 Sonnet or GPT-4o)

## Architecture

### Entry Points

- `src/cli.ts` — Commander.js CLI setup. Three commands: default (interactive chat), `test` (deterministic test execution), and `discover` (AI-powered test plan generation).

### Module Layout

| Directory | Purpose |
|-----------|---------|
| `src/ui/` | Ink React components: `App.tsx` (root state machine), `Chat.tsx` (message display), `Input.tsx` (single-line input with cursor) |
| `src/gemini/` | `client.ts` (Gemini API calls, response/plan parsing), `prompts.ts` (system prompt, prompt builders) |
| `src/repo/` | `scanner.ts` (detect React/Vite, build file tree), `summarizer.ts` (text summary for LLM context) |
| `src/fs/` | `writer.ts` (apply execution plans), `validator.ts` (TypeScript compiler API validation), `diff.ts` (diff generation) |
| `src/browser/` | `browserbase.ts` (Stagehand LOCAL mode, headless browser sessions), `types.ts` (ConsoleMessage, UncaughtError, FrontlyBrowserArtifacts) |
| `src/commands/` | `test.ts` (deterministic test runner), `discover.ts` (LLM-powered exploration), `shared.ts` (build/serve utilities, port config) |
| `src/testing/` | Test infrastructure: `types.ts`, `executor.ts`, `plans.ts`, `persistence.ts`, `trace.ts`, `trace-to-plan.ts`, `selectors.ts`, `visual-assertions.ts` |
| `src/artifacts/` | `persist.ts` (legacy artifact storage to `.frontly/artifacts/TIMESTAMP/`) |

### Commands

**`frontly`** (default) — Interactive chat for code generation. Requires `GEMINI_API_KEY`.

**`frontly test --plan <name>`** — Deterministic test execution (no LLM). Loads a TestPlan from `.frontly/tests/{name}.plan.json`, builds the project, starts a preview server on port 4173, executes steps via Playwright, and persists results to `.frontly/runs/{planName}/{timestamp}/`.

**`frontly discover <intent>`** — AI-powered exploration. Uses Stagehand's `observe()` and `act()` to explore the running app, captures a trace of interactions, converts the trace to a deterministic TestPlan via `trace-to-plan.ts`, and saves it to `.frontly/tests/`. Max 10 exploration steps with staleness detection.

### Testing Infrastructure

**Key principle:** LLM calls happen ONLY during `discover`. The `test` command is fully deterministic — it uses Playwright locators, no AI.

**TestStep types:** `navigate`, `assertRoute`, `click`, `fill`

**Visual assertions** (executed after test steps): `elementVisible`, `elementInViewport`, `elementNotOverlapped`, `minSize`, `noHorizontalOverflow`

**Trace capture** (`src/testing/trace.ts`): Uses `page.exposeFunction` + `addInitScript` + `framenavigated` events to record clicks, fills, navigations, and route changes during discovery.

**Selector priority** (`src/testing/selectors.ts`): `data-testid` > `aria-label` > `role+text` > `button/link text` > `input name` > `input placeholder` > `tagName`

**Persistence:** Test results go to `.frontly/runs/{planName}/{timestamp}/` with `meta.json`, `console.json`, `errors.json`, and `visual-assertions.json`.

### Core Data Flow (Chat)

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
- fs-extra imported as: `import pkg from 'fs-extra'; const { ... } = pkg;`
- Core types defined in `src/types.ts`; testing types in `src/testing/types.ts`
- JSX uses `react-jsx` transform (no manual React import needed in JSX files)

## Validation Behavior

The TypeScript compiler API is used for file validation:
- Syntax errors are blocking (plan application fails)
- Semantic errors are treated as warnings
- "Cannot find module" and "Cannot find name" errors are skipped (incomplete project context)
