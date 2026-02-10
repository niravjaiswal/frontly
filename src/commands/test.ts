/**
 * Test Command
 *
 * Detects a React + Vite frontend project, builds it deterministically,
 * serves the production build on a fixed port, and executes a TestPlan
 * using Stagehand in LOCAL mode (no tunnels, no remote browsers, no LLM).
 */

import { type ExecaError } from 'execa';
import pkg from 'fs-extra';
const { readJson, pathExists, writeJson } = pkg;
import { join } from 'node:path';
import chalk from 'chalk';
import { ensureDefaultPlan, loadTestPlan } from '../testing/plans.js';
import { executeTestPlan } from '../testing/executor.js';
import { persistRunResult } from '../testing/persistence.js';
import { loadBaseline, saveBaseline } from '../testing/baselines.js';
import { compareRuns } from '../testing/compare.js';
import type { RunComparison } from '../testing/compare.js';
import type { TestRunResult } from '../testing/types.js';
import { createFailureSummary } from '../testing/failure-summary.js';
import { detectProject, runBuild, startPreviewServer, PREVIEW_PORT } from './shared.js';

/**
 * Main test command handler.
 *
 * Loads a TestPlan, builds and serves the project, then executes
 * the plan step-by-step using a headless browser.
 * Returns structured test results.
 */
export async function testCommand(planName?: string, accept?: boolean): Promise<TestRunResult | null> {
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
  const assertionCount = plan.visualAssertions?.length ?? 0;
  console.log(chalk.dim(`  Steps: ${plan.steps.length}, Checkpoints: ${plan.visualCheckpoints.length}, Assertions: ${assertionCount}`));

  // Display baseline status
  const existingBaseline = await loadBaseline(resolvedPlanName, cwd);
  if (existingBaseline) {
    console.log(chalk.dim(`  Baseline: ${existingBaseline.runTimestamp}`));
  } else {
    console.log(chalk.dim('  Baseline: none'));
  }
  console.log('');

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

    // Baseline comparison
    let comparison: RunComparison | undefined;
    if (existingBaseline) {
      const baselineRunDir = join(cwd, '.frontly/runs', plan.name, existingBaseline.runTimestamp);
      const baselineMetaPath = join(baselineRunDir, 'meta.json');
      if (await pathExists(baselineMetaPath)) {
        const baselineResult = await readJson(baselineMetaPath) as TestRunResult;
        comparison = compareRuns(baselineResult, result);

        if (comparison.status === 'regressed') {
          console.log(chalk.red(`\n  ❌ Regressions detected vs baseline (${existingBaseline.runTimestamp})`));

          if (comparison.stepRegressions.length > 0) {
            console.log(chalk.red('\n  Step regressions:'));
            for (const reg of comparison.stepRegressions) {
              const desc = reg.description ? reg.description : `Step ${reg.stepIndex}`;
              console.log(chalk.red(`  - Step ${reg.stepIndex}: ${desc}`));
              console.log(chalk.red('    Previously passed, now failed'));
              if (reg.error) {
                console.log(chalk.red(`    Error: ${reg.error}`));
              }
            }
          }

          if (comparison.visualAssertionRegressions.length > 0) {
            console.log(chalk.red('\n  Visual assertion regressions:'));
            for (const reg of comparison.visualAssertionRegressions) {
              console.log(chalk.red(`  - ${reg.name}`));
              console.log(chalk.red('    Previously passed, now failed'));
            }
          }

          if (comparison.newConsoleErrors.length > 0) {
            console.log(chalk.red('\n  New console errors:'));
            for (const msg of comparison.newConsoleErrors) {
              console.log(chalk.red(`  - ${msg}`));
            }
          }

          await writeJson(join(runDir, 'comparison.json'), comparison, { spaces: 2 });
        } else {
          console.log(chalk.dim('\n  No regressions detected vs baseline'));
        }
      } else {
        console.log(chalk.dim('\n  Baseline run not found — skipping comparison'));
      }
    } else {
      console.log(chalk.dim('\n  No baseline — skipping comparison'));
    }

    // Generate failure summary for downstream consumers (auto-fix loop, CI)
    const failureSummary = createFailureSummary(plan.name, result, runDir, comparison);
    if (failureSummary) {
      await writeJson(join(runDir, 'failure-summary.json'), failureSummary, { spaces: 2 });
      console.log(chalk.dim(`\n  Failure summary written to .frontly/runs/${plan.name}/${result.timestamp}/failure-summary.json`));
    }

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

    // Print visual assertion summary
    if (result.visualAssertionResults.length > 0) {
      const passed = result.visualAssertionResults.filter(r => r.status === 'passed').length;
      const failed = result.visualAssertionResults.filter(r => r.status === 'failed').length;
      console.log(chalk.dim(`  Visual assertions: ${passed} passed, ${failed} failed`));
      for (const ar of result.visualAssertionResults) {
        if (ar.status === 'failed') {
          const label = ar.assertion.description || ar.assertion.type;
          console.log(chalk.red(`    ${label}: ${ar.message}`));
        }
      }
    }

    console.log(chalk.dim(`  Results: ${runDir}`));

    // Handle --accept flag
    if (accept) {
      if (result.status === 'passed') {
        await saveBaseline(resolvedPlanName, result.timestamp, cwd);
        console.log(chalk.green(`\n  Baseline set for plan "${resolvedPlanName}"`));
      } else {
        console.log(chalk.red('\n  Cannot accept baseline — test failed'));
      }
    }

    console.log('');
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
