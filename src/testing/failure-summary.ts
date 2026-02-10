import type { TestRunResult } from './types.js';
import type { RunComparison } from './compare.js';

// ── Types ──────────────────────────────────────────────────────────

export type FailedStepSummary = {
  stepIndex: number;
  type: string;
  description?: string;
  selector?: string;
  error: string;
};

export type FailedVisualAssertionSummary = {
  assertionIndex: number;
  type: string;
  selector?: string;
  reason: string;
};

export type ConsoleErrorSummary = {
  message: string;
  stack?: string;
};

export type ArtifactPointers = {
  screenshots: Record<string, string>;
  domSnapshots: Record<string, string>;
};

export type FailureSummary = {
  planName: string;
  runTimestamp: string;
  failedSteps: FailedStepSummary[];
  failedVisualAssertions: FailedVisualAssertionSummary[];
  newConsoleErrors: ConsoleErrorSummary[];
  artifacts: ArtifactPointers;
};

// ── Summarization ──────────────────────────────────────────────────

/**
 * Create a compact failure summary from a test run result.
 *
 * Returns null if the run passed with no regressions — i.e. there is
 * nothing actionable for a downstream consumer (auto-fix loop, CI, etc.).
 *
 * This function is pure and deterministic. It reads only from its arguments
 * and produces no side effects.
 */
export function createFailureSummary(
  planName: string,
  runResult: TestRunResult,
  runDir: string,
  comparison?: RunComparison,
): FailureSummary | null {
  const hasFailure = runResult.status === 'failed';
  const hasRegressions = comparison?.status === 'regressed';

  if (!hasFailure && !hasRegressions) {
    return null;
  }

  // ── Failed steps ───────────────────────────────────────────────

  const failedSteps: FailedStepSummary[] = runResult.steps
    .filter(s => s.status === 'failed')
    .map(s => {
      const summary: FailedStepSummary = {
        stepIndex: s.stepIndex,
        type: s.step.type,
        error: s.error ?? 'unknown error',
      };
      if ('description' in s.step) {
        summary.description = (s.step as { description?: string }).description;
      }
      if ('selector' in s.step) {
        summary.selector = (s.step as { selector?: string }).selector;
      }
      return summary;
    });

  // ── Failed visual assertions ───────────────────────────────────

  const failedVisualAssertions: FailedVisualAssertionSummary[] = runResult
    .visualAssertionResults
    .filter(r => r.status === 'failed')
    .map((r, i) => {
      const summary: FailedVisualAssertionSummary = {
        assertionIndex: i,
        type: r.assertion.type,
        reason: r.message,
      };
      if ('selector' in r.assertion) {
        summary.selector = (r.assertion as { selector?: string }).selector;
      }
      return summary;
    });

  // ── Console errors ─────────────────────────────────────────────
  // Prefer comparison.newConsoleErrors when a baseline exists —
  // this filters out known/pre-existing noise.

  let newConsoleErrors: ConsoleErrorSummary[];

  if (comparison && comparison.newConsoleErrors.length > 0) {
    newConsoleErrors = comparison.newConsoleErrors.map(msg => ({ message: msg }));
  } else if (!comparison) {
    // No baseline — include all console errors and uncaught errors
    const consoleErrors: ConsoleErrorSummary[] = runResult.consoleMessages
      .filter(m => m.type === 'error')
      .map(m => ({ message: m.message }));
    const uncaughtErrors: ConsoleErrorSummary[] = runResult.uncaughtErrors
      .map(e => ({ message: e.message, stack: e.stack }));
    newConsoleErrors = [...consoleErrors, ...uncaughtErrors];
  } else {
    newConsoleErrors = [];
  }

  // ── Artifact pointers ──────────────────────────────────────────

  const screenshots: Record<string, string> = {};
  const domSnapshots: Record<string, string> = {};

  for (const cp of runResult.checkpoints) {
    screenshots[cp.name] = `${runDir}/${cp.screenshotPath}`;
    domSnapshots[cp.name] = `${runDir}/${cp.domSnapshotPath}`;
  }

  return {
    planName,
    runTimestamp: runResult.timestamp,
    failedSteps,
    failedVisualAssertions,
    newConsoleErrors,
    artifacts: { screenshots, domSnapshots },
  };
}
