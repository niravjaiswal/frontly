/**
 * Shared Project Lifecycle Utilities
 *
 * Common logic used by both the `test` and `discover` commands:
 * project detection, production build, and preview server management.
 */

import { execa, type ExecaError } from 'execa';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

export const PREVIEW_PORT = 4173;

const HEALTH_CHECK_INTERVAL_MS = 500;
const HEALTH_CHECK_TIMEOUT_MS = 30000;

const VITE_CONFIG_PATTERNS = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'vite.config.mjs',
];

export interface DetectionResult {
  hasVite: boolean;
  hasReact: boolean;
  errors: string[];
}

/**
 * Detect if the current directory is a React + Vite project
 */
export function detectProject(cwd: string): DetectionResult {
  const result: DetectionResult = {
    hasVite: false,
    hasReact: false,
    errors: [],
  };

  // Check for vite.config.*
  result.hasVite = VITE_CONFIG_PATTERNS.some((pattern) =>
    existsSync(join(cwd, pattern))
  );

  if (!result.hasVite) {
    result.errors.push('No vite.config.* file found. Is this a Vite project?');
  }

  // Check for package.json with react dependency
  const packageJsonPath = join(cwd, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
      result.hasReact = 'react' in deps;

      if (!result.hasReact) {
        result.errors.push(
          'No "react" dependency found in package.json. Is this a React project?'
        );
      }
    } catch {
      result.errors.push('Failed to parse package.json');
    }
  } else {
    result.errors.push('No package.json found in current directory.');
  }

  return result;
}

/**
 * Run the production build
 */
export async function runBuild(cwd: string): Promise<boolean> {
  console.log(chalk.cyan('\n  Building production bundle...\n'));

  try {
    const result = await execa('npm', ['run', 'build'], {
      cwd,
      stdio: 'inherit',
    });
    return result.exitCode === 0;
  } catch (error) {
    const execaError = error as ExecaError;
    console.error(chalk.red('\n  Build failed'));
    if (execaError.stderr) {
      console.error(chalk.dim(execaError.stderr));
    }
    return false;
  }
}

/**
 * Wait for server to be reachable
 */
export async function waitForServer(
  port: number,
  timeoutMs: number
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${port}`);
      if (response.ok || response.status === 304) {
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
  }

  return false;
}

/**
 * Start the preview server and wait until it is reachable.
 * Returns the child-process handle — the caller owns cleanup.
 */
export async function startPreviewServer(cwd: string) {
  console.log(chalk.cyan(`\n  Starting preview server on port ${PREVIEW_PORT}...\n`));

  const serverProcess = execa(
    'npm',
    ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--host'],
    {
      cwd,
      stdio: 'pipe',
    }
  );

  serverProcess.stdout?.pipe(process.stdout);
  serverProcess.stderr?.pipe(process.stderr);

  console.log(chalk.dim('  Waiting for server to be ready...'));
  const isReady = await waitForServer(PREVIEW_PORT, HEALTH_CHECK_TIMEOUT_MS);

  if (!isReady) {
    serverProcess.kill('SIGTERM');
    throw new Error(`Server failed to start within ${HEALTH_CHECK_TIMEOUT_MS / 1000}s`);
  }

  console.log(chalk.green(`\n  Server ready at http://localhost:${PREVIEW_PORT}`));

  return { serverProcess };
}
