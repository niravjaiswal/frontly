/**
 * Test Command
 *
 * Detects a React + Vite frontend project, builds it deterministically,
 * serves the production build on a fixed port, and executes a TestPlan
 * using Stagehand in LOCAL mode (no tunnels, no remote browsers, no LLM).
 */

import { type ExecaError } from 'execa';
import { join } from 'node:path';
import chalk from 'chalk';
import { ensureDefaultPlan, loadTestPlan } from '../testing/plans.js';
import { executeTestPlan } from '../testing/executor.js';
import { persistRunResult } from '../testing/persistence.js';
import type { TestRunResult } from '../testing/types.js';
import { detectProject, runBuild, startPreviewServer, PREVIEW_PORT } from './shared.js';

/**
 * Main test command handler.
 *
 * Loads a TestPlan, builds and serves the project, then executes
 * the plan step-by-step using a headless browser.
 * Returns structured test results.
 */
export async function testCommand(planName?: string): Promise<TestRunResult | null> {
  const cwd = process.cwd();
  const resolvedPlanName = planName ?? 'smoke';

  console.log(chalk.cyan.bold('\n  Frontly Test'));
  console.log(chalk.dim('  Build, serve, and execute test plan\n'));

  // Step 1: Ensure default plan exists and load the requested plan
  await ensureDefaultPlan(cwd);

  let plan;
  try {
    plan = await loadTestPlan(resolvedPlanName, cwd);
  } catch (error) {
    console.log(chalk.red(`\n  ${(error as Error).message}\n`));
    process.exit(1);
  }

  console.log(chalk.dim(`  Plan: ${plan.name}`));
  console.log(chalk.dim(`  Intent: "${plan.intent}"`));
  console.log(chalk.dim(`  Steps: ${plan.steps.length}, Checkpoints: ${plan.visualCheckpoints.length}\n`));

  // Step 2: Detect project
  console.log(chalk.dim('  Detecting project type...'));
  const detection = detectProject(cwd);

  if (detection.errors.length > 0) {
    console.log(chalk.red('\n  Project detection failed:'));
    for (const error of detection.errors) {
      console.log(chalk.red(`    - ${error}`));
    }
    console.log(
      chalk.dim('\n  Ensure you are in a React + Vite project directory.\n')
    );
    process.exit(1);
  }

  console.log(chalk.green('  Detected React + Vite project'));

  // Step 3: Build
  const buildSuccess = await runBuild(cwd);
  if (!buildSuccess) {
    console.log(chalk.red('\n  Build failed. Aborting.\n'));
    process.exit(1);
  }

  console.log(chalk.green('\n  Build completed successfully'));

  // Step 4: Serve
  const { serverProcess } = await startPreviewServer(cwd);

  // Step 5: Execute test plan
  const baseUrl = `http://localhost:${PREVIEW_PORT}`;
  let result: TestRunResult | null = null;

  console.log(chalk.cyan('\n  Executing test plan...'));
  try {
    result = await executeTestPlan(plan, baseUrl, cwd);

    // Persist run results
    // The executor already created the run dir and wrote checkpoints;
    // find the run dir from the result timestamp
    const runDir = join(
      cwd,
      '.frontly/runs',
      plan.name,
      result.timestamp
    );
    await persistRunResult(result, runDir);

    if (result.status === 'passed') {
      console.log(chalk.green(`\n  Test plan "${plan.name}" passed`));
    } else {
      console.log(chalk.red(`\n  Test plan "${plan.name}" failed`));
      if (result.error) {
        console.log(chalk.red(`  Error: ${result.error}`));
      }
      for (const step of result.steps) {
        if (step.status === 'failed') {
          console.log(chalk.red(`    Step ${step.stepIndex}: ${step.error}`));
        }
      }
    }

    console.log(chalk.dim(`  Results: ${runDir}\n`));
  } catch (error) {
    console.log(chalk.yellow(`\n  Test execution failed: ${(error as Error).message}\n`));
  }

  // Cleanup: kill server and wait for termination
  serverProcess.kill('SIGTERM');
  try {
    await serverProcess;
  } catch (error) {
    const execaError = error as ExecaError;
    // Exit code 143 = SIGTERM (128 + 15), expected when we kill the server
    if (execaError.exitCode !== 143) {
      throw error;
    }
  }

  console.log(chalk.dim('  Server stopped.\n'));
  return result;
}
