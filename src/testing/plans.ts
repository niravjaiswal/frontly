import pkg from 'fs-extra';
const { ensureDir, pathExists, readJson, writeJson, readdir } = pkg;
import { join } from 'node:path';
import type { TestPlan } from './types.js';

const PLANS_DIR = '.frontly/tests';

const DEFAULT_PLAN: TestPlan = {
  name: 'smoke',
  intent: 'Verify the application loads and renders without errors',
  steps: [{ type: 'navigate', url: '/' }],
  visualCheckpoints: [{ name: 'initial-load', afterStep: 0 }],
};

function getPlansDir(cwd: string): string {
  return join(cwd, PLANS_DIR);
}

function planFilePath(planName: string, cwd: string): string {
  return join(getPlansDir(cwd), `${planName}.plan.json`);
}

/**
 * Load a TestPlan from disk by name.
 * Throws if the plan file does not exist or is malformed.
 */
export async function loadTestPlan(
  planName: string,
  cwd: string = process.cwd()
): Promise<TestPlan> {
  const filePath = planFilePath(planName, cwd);

  if (!(await pathExists(filePath))) {
    throw new Error(`Test plan not found: ${filePath}`);
  }

  const raw = await readJson(filePath) as TestPlan;

  // Basic shape validation
  if (!raw.name || !raw.intent || !Array.isArray(raw.steps)) {
    throw new Error(
      `Invalid test plan at ${filePath}: must have name, intent, and steps`
    );
  }

  if (!Array.isArray(raw.visualCheckpoints)) {
    throw new Error(
      `Invalid test plan at ${filePath}: visualCheckpoints must be an array`
    );
  }

  for (const checkpoint of raw.visualCheckpoints) {
    if (checkpoint.afterStep < 0 || checkpoint.afterStep >= raw.steps.length) {
      throw new Error(
        `Invalid checkpoint "${checkpoint.name}": afterStep ${checkpoint.afterStep} is out of range (0..${raw.steps.length - 1})`
      );
    }
  }

  return raw;
}

/**
 * Ensure the default smoke plan exists on disk.
 * Creates .frontly/tests/smoke.plan.json if it doesn't exist.
 */
export async function ensureDefaultPlan(
  cwd: string = process.cwd()
): Promise<void> {
  const filePath = planFilePath('smoke', cwd);

  if (await pathExists(filePath)) {
    return;
  }

  await ensureDir(getPlansDir(cwd));
  await writeJson(filePath, DEFAULT_PLAN, { spaces: 2 });
}

/**
 * List available test plan names in the .frontly/tests/ directory.
 */
export async function listTestPlans(
  cwd: string = process.cwd()
): Promise<string[]> {
  const dir = getPlansDir(cwd);

  if (!(await pathExists(dir))) {
    return [];
  }

  const files = await readdir(dir) as string[];
  return files
    .filter((f: string) => f.endsWith('.plan.json'))
    .map((f: string) => f.replace('.plan.json', ''));
}
