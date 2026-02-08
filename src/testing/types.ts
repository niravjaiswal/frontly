import type { ConsoleMessage, UncaughtError } from '../browser/types.js';

export type TestStep =
  | { type: 'navigate'; url: string }
  | { type: 'assertRoute'; path: string }
  | { type: 'click'; selector: string; description: string }
  | { type: 'fill'; selector: string; value: string; description: string };

export type VisualCheckpoint = {
  name: string;
  afterStep: number; // 0-indexed reference into steps[]
};

export type TestPlan = {
  name: string;
  intent: string;
  steps: TestStep[];
  visualCheckpoints: VisualCheckpoint[];
  visualAssertions?: VisualAssertion[];
};

export type VisualAssertion =
  | { type: 'elementVisible'; selector: string; description?: string }
  | { type: 'elementInViewport'; selector: string; description?: string }
  | { type: 'elementNotOverlapped'; selector: string; description?: string }
  | { type: 'minSize'; selector: string; minWidth: number; minHeight: number; description?: string }
  | { type: 'noHorizontalOverflow'; description?: string };

export type VisualAssertionResult = {
  assertion: VisualAssertion;
  status: 'passed' | 'failed';
  message: string;
};

export type StepResult = {
  stepIndex: number;
  step: TestStep;
  status: 'passed' | 'failed';
  error?: string;
  durationMs: number;
};

export type CheckpointArtifact = {
  name: string;
  screenshotPath: string; // relative to run dir
  domSnapshotPath: string; // relative to run dir
};

export type TestRunResult = {
  plan: string; // plan name
  intent: string;
  timestamp: string;
  status: 'passed' | 'failed';
  steps: StepResult[];
  checkpoints: CheckpointArtifact[];
  visualAssertionResults: VisualAssertionResult[];
  consoleMessages: ConsoleMessage[];
  uncaughtErrors: UncaughtError[];
  durationMs: number;
  error?: string; // top-level failure reason if applicable
};
