import pkg from 'fs-extra';
const { ensureDir, writeJson } = pkg;
import { join } from 'node:path';
import type { TestRunResult } from './types.js';

const RUNS_DIR = '.frontly/runs';

/**
 * Generate timestamp in YYYY-MM-DDTHH-mm-ss format.
 */
function generateTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/:/g, '-');
}

/**
 * Create the run directory for a plan execution.
 * Returns the absolute path to the new run directory.
 *
 * Structure: .frontly/runs/{planName}/{timestamp}/
 */
export async function createRunDir(
  planName: string,
  cwd: string = process.cwd()
): Promise<string> {
  const timestamp = generateTimestamp();
  const runDir = join(cwd, RUNS_DIR, planName, timestamp);
  await ensureDir(runDir);
  return runDir;
}

/**
 * Persist a TestRunResult to the given run directory.
 *
 * Writes:
 *   meta.json    — full run result metadata
 *   console.json — console messages captured during the run
 *   errors.json  — uncaught errors captured during the run
 *
 * Screenshots and DOM snapshots are already written by the executor
 * during checkpoint capture.
 */
export async function persistRunResult(
  result: TestRunResult,
  runDir: string
): Promise<void> {
  await writeJson(join(runDir, 'meta.json'), result, { spaces: 2 });
  await writeJson(join(runDir, 'console.json'), result.consoleMessages, {
    spaces: 2,
  });
  await writeJson(join(runDir, 'errors.json'), result.uncaughtErrors, {
    spaces: 2,
  });

  if (result.visualAssertionResults.length > 0) {
    await writeJson(join(runDir, 'visual-assertions.json'), result.visualAssertionResults, {
      spaces: 2,
    });
  }
}
