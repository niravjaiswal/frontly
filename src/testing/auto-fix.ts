/**
 * Auto-Fix Module
 *
 * Given a failed test run, constructs a structured LLM prompt from the
 * failure summary and test plan, calls Gemini to produce an ExecutionPlan
 * that addresses the failures, and returns the plan for user approval.
 *
 * This module never applies changes directly — it only proposes plans.
 * LLM calls are isolated here; the test runner remains deterministic.
 */

import pkg from 'fs-extra';
const { readJson, pathExists } = pkg;
import { join } from 'node:path';
import type { ExecutionPlan } from '../types.js';
import type { TestPlan, TestStep } from './types.js';
import type { FailureSummary } from './failure-summary.js';
import { sendMessage, parseResponse } from '../gemini/client.js';
import { scanRepository } from '../repo/scanner.js';
import { createRepoSummary } from '../repo/summarizer.js';
import { loadFeatureIntent } from '../intent/feature-intent.js';

// ── Types ──────────────────────────────────────────────────────────

export type AutoFixOptions = {
  planName: string;
  runTimestamp: string;
  cwd: string;
};

export type AutoFixResult =
  | { status: 'proposed'; plan: ExecutionPlan }
  | { status: 'no-failure-summary' }
  | { status: 'no-plan-returned' }
  | { status: 'error'; message: string };

// ── Core ───────────────────────────────────────────────────────────

/**
 * Load the failure summary and test plan, build a fix prompt,
 * call Gemini, and return a proposed ExecutionPlan (or a reason
 * why one could not be produced).
 */
export async function attemptAutoFix(
  options: AutoFixOptions,
): Promise<AutoFixResult> {
  const { planName, runTimestamp, cwd } = options;
  const runDir = join(cwd, '.frontly/runs', planName, runTimestamp);

  // Load failure summary
  const summaryPath = join(runDir, 'failure-summary.json');
  if (!(await pathExists(summaryPath))) {
    return { status: 'no-failure-summary' };
  }
  const failureSummary = (await readJson(summaryPath)) as FailureSummary;

  // Load test plan for context
  const planPath = join(cwd, '.frontly/tests', `${planName}.plan.json`);
  const testPlan = (await readJson(planPath)) as TestPlan;

  // Build repo context for Gemini
  const repoContext = await scanRepository(cwd);
  const repoSummary = createRepoSummary(repoContext);

  // Build prompt and call LLM
  const prompt = await buildFixPrompt(failureSummary, testPlan, cwd);

  try {
    const response = await sendMessage(prompt, [], repoSummary);
    const parsed = parseResponse(response.text);

    if (!parsed.plan) {
      return { status: 'no-plan-returned' };
    }

    return { status: 'proposed', plan: parsed.plan };
  } catch (error) {
    return { status: 'error', message: (error as Error).message };
  }
}

// ── Prompt construction ────────────────────────────────────────────

/**
 * Build a structured prompt that gives Gemini enough context to produce
 * a targeted fix. Only failed items are included to keep the prompt
 * focused and avoid unnecessary changes.
 */
async function buildFixPrompt(
  summary: FailureSummary,
  testPlan: TestPlan,
  cwd: string,
): Promise<string> {
  const parts: string[] = [];

  // Load feature intent if available
  const featureIntent = await loadFeatureIntent(cwd);

  parts.push(
    'A test plan just failed. Analyze the failures below and produce an ExecutionPlan that fixes ONLY what is necessary.',
  );
  parts.push('');

  // Feature intent section
  if (featureIntent) {
    parts.push('## ORIGINAL FEATURE INTENT (do not change)');
    parts.push('');
    parts.push(featureIntent.intent);
    parts.push('');
    parts.push('CRITICAL: Fix the failures below in service of this original intent.');
    parts.push('- Do NOT remove features that were part of the intent.');
    parts.push('- Do NOT change the scope of the original feature request.');
    parts.push('- Do NOT add unrelated functionality.');
    parts.push('- Focus ONLY on fixing what is broken.');
    parts.push('');
  }

  // ── Test plan context ──────────────────────────────────────────
  parts.push('## Test Plan');
  parts.push(`Name: ${testPlan.name}`);
  parts.push(`Intent: ${testPlan.intent}`);
  parts.push('Steps:');
  for (let i = 0; i < testPlan.steps.length; i++) {
    parts.push(`  ${i}. ${formatStep(testPlan.steps[i])}`);
  }
  parts.push('');

  // ── Failures ───────────────────────────────────────────────────
  parts.push('## Failures');

  if (summary.failedSteps.length > 0) {
    parts.push('');
    parts.push('### Failed Steps');
    for (const s of summary.failedSteps) {
      const selector = s.selector ? ` (selector: "${s.selector}")` : '';
      const desc = s.description ? ` — ${s.description}` : '';
      parts.push(`- Step ${s.stepIndex} [${s.type}]${selector}${desc}: ${s.error}`);
    }
  }

  if (summary.failedVisualAssertions.length > 0) {
    parts.push('');
    parts.push('### Failed Visual Assertions');
    for (const a of summary.failedVisualAssertions) {
      const selector = a.selector ? ` (selector: "${a.selector}")` : '';
      parts.push(`- ${a.type}${selector}: ${a.reason}`);
    }
  }

  if (summary.newConsoleErrors.length > 0) {
    parts.push('');
    parts.push('### Console Errors');
    for (const e of summary.newConsoleErrors) {
      parts.push(`- ${e.message}`);
      if (e.stack) {
        // Include first 3 lines of stack for context
        const stackLines = e.stack.split('\n').slice(0, 3).join('\n    ');
        parts.push(`    ${stackLines}`);
      }
    }
  }

  // ── Visual diagnostic findings ─────────────────────────────────
  if (summary.visualIssues && summary.visualIssues.length > 0) {
    parts.push('');
    parts.push('### VISUAL DIAGNOSTIC FINDINGS (may be imperfect)');
    parts.push('');
    parts.push('These were generated by an AI visual judge. Treat as hints, not facts.');
    parts.push('Prioritize deterministic failures above. Do NOT remove features to silence visual issues.');
    parts.push('');
    for (const issue of summary.visualIssues) {
      parts.push(`- [${issue.type}] "${issue.checkpoint}" (confidence ${issue.confidence.toFixed(2)}): ${issue.description}`);
    }
  }

  // ── Artifact pointers ──────────────────────────────────────────
  const hasArtifacts =
    Object.keys(summary.artifacts.screenshots).length > 0 ||
    Object.keys(summary.artifacts.domSnapshots).length > 0;

  if (hasArtifacts) {
    parts.push('');
    parts.push('## Artifact Paths (for reference)');
    for (const [name, filePath] of Object.entries(summary.artifacts.screenshots)) {
      parts.push(`- Screenshot "${name}": ${filePath}`);
    }
    for (const [name, filePath] of Object.entries(summary.artifacts.domSnapshots)) {
      parts.push(`- DOM snapshot "${name}": ${filePath}`);
    }
  }

  // ── Instructions ───────────────────────────────────────────────
  parts.push('');
  parts.push('## Instructions');
  parts.push('- Produce an ExecutionPlan that fixes ONLY the failures above.');
  parts.push('- Make MINIMAL changes — do not refactor unrelated code.');
  parts.push('- Respect existing project structure and code conventions.');
  parts.push('- The test plan is NOT wrong — fix the application code to satisfy it.');
  parts.push('- If a selector is not found, ensure the target element exists with the right attributes.');
  parts.push('- If there are console errors, trace the root cause and fix it.');
  parts.push('');
  parts.push('Respond with a ```json:plan block containing ONLY the ExecutionPlan. No other text.');

  return parts.join('\n');
}

/**
 * Format a TestStep for display in the prompt.
 */
function formatStep(step: TestStep): string {
  switch (step.type) {
    case 'navigate':
      return `navigate to ${step.url}`;
    case 'assertRoute':
      return `assertRoute "${step.path}"`;
    case 'click':
      return `click "${step.selector}" — ${step.description}`;
    case 'fill':
      return `fill "${step.selector}" with "${step.value}" — ${step.description}`;
  }
}
