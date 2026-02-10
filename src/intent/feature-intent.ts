import pkg from 'fs-extra';
const { ensureDir, readJson, writeJson, pathExists } = pkg;
import { join } from 'node:path';

const INTENT_FILE = '.frontly/intent.json';

export interface FeatureIntent {
  intent: string;
  source: 'chat' | 'manual';
  acceptedAt: string; // ISO 8601 timestamp
}

function intentPath(cwd: string): string {
  return join(cwd, INTENT_FILE);
}

/**
 * Load the current feature intent from disk.
 * Returns null if no intent has been saved.
 */
export async function loadFeatureIntent(
  cwd: string = process.cwd()
): Promise<FeatureIntent | null> {
  const filePath = intentPath(cwd);
  if (!(await pathExists(filePath))) {
    return null;
  }
  return readJson(filePath) as Promise<FeatureIntent>;
}

/**
 * Save a new feature intent to disk.
 * Overwrites any existing intent.
 */
export async function saveFeatureIntent(
  intent: string,
  source: 'chat' | 'manual',
  cwd: string = process.cwd()
): Promise<void> {
  await ensureDir(join(cwd, '.frontly'));
  const featureIntent: FeatureIntent = {
    intent,
    source,
    acceptedAt: new Date().toISOString(),
  };
  await writeJson(intentPath(cwd), featureIntent, { spaces: 2 });
}

/**
 * Check if a feature intent exists on disk.
 */
export async function intentExists(
  cwd: string = process.cwd()
): Promise<boolean> {
  return pathExists(intentPath(cwd));
}
