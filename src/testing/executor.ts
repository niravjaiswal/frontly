import { join } from 'node:path';
import pkg from 'fs-extra';
const { ensureDir, writeFile } = pkg;
import { createBrowserSession, type BrowserSession } from '../browser/browserbase.js';
import type {
  TestPlan,
  TestStep,
  StepResult,
  CheckpointArtifact,
  TestRunResult,
  VisualCheckpoint,
} from './types.js';
import { createRunDir } from './persistence.js';

const PAGE_LOAD_TIMEOUT_MS = 30_000;
const POST_NAVIGATE_WAIT_MS = 1_000;

/**
 * Execute a navigate step: go to baseUrl + step.url.
 */
async function executeNavigate(
  session: BrowserSession,
  step: { type: 'navigate'; url: string },
  baseUrl: string
): Promise<StepResult> {
  const startTime = Date.now();
  const fullUrl = step.url.startsWith('http') ? step.url : `${baseUrl}${step.url}`;

  try {
    await session.page.goto(fullUrl, {
      waitUntil: 'load',
      timeout: PAGE_LOAD_TIMEOUT_MS,
    });
    // Grace period for async rendering / errors
    await session.page.waitForTimeout(POST_NAVIGATE_WAIT_MS);

    return {
      stepIndex: -1, // filled by caller
      step,
      status: 'passed',
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      stepIndex: -1,
      step,
      status: 'failed',
      error: `Navigation to ${fullUrl} failed: ${(error as Error).message}`,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute an assertRoute step: verify the current page pathname matches.
 */
async function executeAssertRoute(
  session: BrowserSession,
  step: { type: 'assertRoute'; path: string }
): Promise<StepResult> {
  const startTime = Date.now();
  const currentUrl = session.page.url();
  let pathname: string;

  try {
    pathname = new URL(currentUrl).pathname;
  } catch {
    return {
      stepIndex: -1,
      step,
      status: 'failed',
      error: `Could not parse current URL: ${currentUrl}`,
      durationMs: Date.now() - startTime,
    };
  }

  if (pathname !== step.path) {
    return {
      stepIndex: -1,
      step,
      status: 'failed',
      error: `Expected route "${step.path}" but found "${pathname}"`,
      durationMs: Date.now() - startTime,
    };
  }

  return {
    stepIndex: -1,
    step,
    status: 'passed',
    durationMs: Date.now() - startTime,
  };
}

/**
 * Execute a single test step.
 */
async function executeStep(
  session: BrowserSession,
  step: TestStep,
  baseUrl: string
): Promise<StepResult> {
  switch (step.type) {
    case 'navigate':
      return executeNavigate(session, step, baseUrl);
    case 'assertRoute':
      return executeAssertRoute(session, step);
  }
}

/**
 * Capture a visual checkpoint: screenshot + DOM snapshot.
 */
async function captureCheckpoint(
  session: BrowserSession,
  checkpoint: VisualCheckpoint,
  runDir: string
): Promise<CheckpointArtifact> {
  const screenshotDir = join(runDir, 'screenshots');
  const domDir = join(runDir, 'dom');
  await ensureDir(screenshotDir);
  await ensureDir(domDir);

  const screenshotPath = `screenshots/${checkpoint.name}.png`;
  const domSnapshotPath = `dom/${checkpoint.name}.html`;

  // Full-page screenshot
  const screenshotBuffer = await session.page.screenshot({
    fullPage: true,
    type: 'png',
  });
  await writeFile(join(runDir, screenshotPath), screenshotBuffer);

  // DOM snapshot
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const domSnapshot: string = await session.page.evaluate(
    () => (globalThis as any).document.body.innerHTML
  );
  await writeFile(join(runDir, domSnapshotPath), domSnapshot, 'utf-8');

  return {
    name: checkpoint.name,
    screenshotPath,
    domSnapshotPath,
  };
}

/**
 * Build a lookup of step index → checkpoints to capture after that step.
 */
function buildCheckpointMap(
  checkpoints: VisualCheckpoint[]
): Map<number, VisualCheckpoint[]> {
  const map = new Map<number, VisualCheckpoint[]>();
  for (const cp of checkpoints) {
    const existing = map.get(cp.afterStep) ?? [];
    existing.push(cp);
    map.set(cp.afterStep, existing);
  }
  return map;
}

/**
 * Execute a full TestPlan against a running server.
 *
 * Steps are executed in order. Assertion failures are recorded
 * but do not halt execution — all steps run to completion.
 * Visual checkpoints are captured after the designated step.
 *
 * The overall run status is 'failed' if any step failed
 * or if uncaught browser errors were detected.
 */
export async function executeTestPlan(
  plan: TestPlan,
  baseUrl: string,
  cwd: string = process.cwd()
): Promise<TestRunResult> {
  const runStartTime = Date.now();
  const runDir = await createRunDir(plan.name, cwd);
  const checkpointMap = buildCheckpointMap(plan.visualCheckpoints);

  const stepResults: StepResult[] = [];
  const checkpointArtifacts: CheckpointArtifact[] = [];

  let session: BrowserSession | null = null;

  try {
    session = await createBrowserSession();

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const result = await executeStep(session, step, baseUrl);
      result.stepIndex = i;
      stepResults.push(result);

      // Capture any checkpoints designated for after this step
      const checkpoints = checkpointMap.get(i);
      if (checkpoints) {
        for (const cp of checkpoints) {
          const artifact = await captureCheckpoint(session, cp, runDir);
          checkpointArtifacts.push(artifact);
        }
      }
    }

    const anyStepFailed = stepResults.some((r) => r.status === 'failed');
    const hasUncaughtErrors = session.uncaughtErrors.length > 0;

    return {
      plan: plan.name,
      intent: plan.intent,
      timestamp: new Date().toISOString().slice(0, 19).replace(/:/g, '-'),
      status: anyStepFailed || hasUncaughtErrors ? 'failed' : 'passed',
      steps: stepResults,
      checkpoints: checkpointArtifacts,
      consoleMessages: session.consoleMessages,
      uncaughtErrors: session.uncaughtErrors,
      durationMs: Date.now() - runStartTime,
      ...(hasUncaughtErrors &&
        !anyStepFailed && {
          error: `${session.uncaughtErrors.length} uncaught error(s) detected`,
        }),
    };
  } catch (error) {
    // Top-level failure (e.g. browser session could not be created)
    return {
      plan: plan.name,
      intent: plan.intent,
      timestamp: new Date().toISOString().slice(0, 19).replace(/:/g, '-'),
      status: 'failed',
      steps: stepResults,
      checkpoints: checkpointArtifacts,
      consoleMessages: session?.consoleMessages ?? [],
      uncaughtErrors: session?.uncaughtErrors ?? [],
      durationMs: Date.now() - runStartTime,
      error: (error as Error).message,
    };
  } finally {
    if (session) {
      await session.close();
    }
  }
}
