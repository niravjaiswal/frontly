import type { TestRunResult } from './types.js';

export type StepRegression = {
  stepIndex: number;
  description?: string;
  baselineStatus: 'passed' | 'failed';
  currentStatus: 'passed' | 'failed';
  error?: string;
};

export type VisualAssertionRegression = {
  name: string;
  baselineStatus: 'passed' | 'failed';
  currentStatus: 'passed' | 'failed';
  error?: string;
};

export type RunComparison = {
  baselineTimestamp: string;
  currentTimestamp: string;
  stepRegressions: StepRegression[];
  visualAssertionRegressions: VisualAssertionRegression[];
  newConsoleErrors: string[];
  status: 'regressed' | 'unchanged';
};

function assertionName(assertion: { type: string; selector?: string; description?: string }): string {
  if (assertion.description) return `${assertion.type}: ${assertion.description}`;
  if (assertion.selector) return `${assertion.type}: ${assertion.selector}`;
  return assertion.type;
}

/**
 * Compare a current test run against a baseline run.
 * Reports only pass→fail regressions (not fail→pass improvements).
 */
export function compareRuns(baseline: TestRunResult, current: TestRunResult): RunComparison {
  // Step regressions: pass→fail transitions by stepIndex
  const stepRegressions: StepRegression[] = [];
  for (const currentStep of current.steps) {
    const baselineStep = baseline.steps.find(s => s.stepIndex === currentStep.stepIndex);
    if (baselineStep && baselineStep.status === 'passed' && currentStep.status === 'failed') {
      const desc = 'description' in currentStep.step
        ? (currentStep.step as { description?: string }).description
        : undefined;
      stepRegressions.push({
        stepIndex: currentStep.stepIndex,
        description: desc,
        baselineStatus: 'passed',
        currentStatus: 'failed',
        error: currentStep.error,
      });
    }
  }

  // Visual assertion regressions: pass→fail by derived name
  const visualAssertionRegressions: VisualAssertionRegression[] = [];
  for (const currentAssertion of current.visualAssertionResults) {
    const name = assertionName(currentAssertion.assertion);
    const baselineAssertion = baseline.visualAssertionResults.find(
      a => assertionName(a.assertion) === name
    );
    if (baselineAssertion && baselineAssertion.status === 'passed' && currentAssertion.status === 'failed') {
      visualAssertionRegressions.push({
        name,
        baselineStatus: 'passed',
        currentStatus: 'failed',
        error: currentAssertion.message,
      });
    }
  }

  // New console errors: errors in current but not in baseline
  const baselineErrors = new Set(
    baseline.consoleMessages
      .filter(m => m.type === 'error')
      .map(m => m.message)
  );
  const currentErrors = current.consoleMessages
    .filter(m => m.type === 'error')
    .map(m => m.message);
  const newConsoleErrors = [...new Set(currentErrors.filter(e => !baselineErrors.has(e)))];

  const hasRegressions =
    stepRegressions.length > 0 ||
    visualAssertionRegressions.length > 0 ||
    newConsoleErrors.length > 0;

  return {
    baselineTimestamp: baseline.timestamp,
    currentTimestamp: current.timestamp,
    stepRegressions,
    visualAssertionRegressions,
    newConsoleErrors,
    status: hasRegressions ? 'regressed' : 'unchanged',
  };
}
