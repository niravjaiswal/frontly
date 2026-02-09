import pkg from 'fs-extra';
const { ensureDir, readJson, writeJson, pathExists } = pkg;
import { join } from 'node:path';

const BASELINES_DIR = '.frontly/baselines';

export interface Baseline {
  plan: string;
  runTimestamp: string;
  createdAt: string;
}

function baselinePath(planName: string, cwd: string): string {
  return join(cwd, BASELINES_DIR, `${planName}.json`);
}

export async function loadBaseline(
  planName: string,
  cwd: string
): Promise<Baseline | null> {
  const filePath = baselinePath(planName, cwd);
  if (!(await pathExists(filePath))) {
    return null;
  }
  return readJson(filePath) as Promise<Baseline>;
}

export async function saveBaseline(
  planName: string,
  runTimestamp: string,
  cwd: string
): Promise<void> {
  await ensureDir(join(cwd, BASELINES_DIR));
  const baseline: Baseline = {
    plan: planName,
    runTimestamp,
    createdAt: new Date().toISOString(),
  };
  await writeJson(baselinePath(planName, cwd), baseline, { spaces: 2 });
}

export async function baselineExists(
  planName: string,
  cwd: string
): Promise<boolean> {
  return pathExists(baselinePath(planName, cwd));
}
