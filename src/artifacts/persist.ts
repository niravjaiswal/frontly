import pkg from 'fs-extra';
const { ensureDir, writeFile, writeJson } = pkg;
import { join } from 'node:path';
import type { FrontlyBrowserArtifacts } from '../browser/types.js';
import type { ArtifactRun, ArtifactMeta } from './types.js';

const ARTIFACTS_DIR = '.frontly/artifacts';

/**
 * Generate timestamp in YYYY-MM-DDTHH-mm-ss format
 */
function generateTimestamp(): string {
  const now = new Date();
  return now.toISOString().slice(0, 19).replace(/:/g, '-');
}

/**
 * Persist browser artifacts to disk.
 * Creates a timestamped directory with screenshot, DOM, console logs, and errors.
 */
export async function persistArtifacts(
  artifacts: FrontlyBrowserArtifacts,
  intent?: string,
  cwd: string = process.cwd()
): Promise<ArtifactRun> {
  const timestamp = generateTimestamp();
  const runDir = join(cwd, ARTIFACTS_DIR, timestamp);

  await ensureDir(runDir);

  // Decode and save screenshot as PNG
  const screenshotBuffer = Buffer.from(artifacts.screenshotBase64, 'base64');
  await writeFile(join(runDir, 'screenshot.png'), screenshotBuffer);

  // Save DOM snapshot as HTML
  await writeFile(join(runDir, 'dom.html'), artifacts.domSnapshot, 'utf-8');

  // Save console messages as pretty JSON
  await writeJson(join(runDir, 'console.json'), artifacts.consoleMessages, { spaces: 2 });

  // Save uncaught errors as pretty JSON
  await writeJson(join(runDir, 'errors.json'), artifacts.uncaughtErrors, { spaces: 2 });

  // Save metadata
  const meta: ArtifactMeta = {
    timestamp,
    command: 'frontly test',
    browser: 'stagehand-local',
    status: 'completed',
    ...(intent && { intent }),
  };
  await writeJson(join(runDir, 'meta.json'), meta, { spaces: 2 });

  return {
    path: runDir,
    timestamp,
  };
}
