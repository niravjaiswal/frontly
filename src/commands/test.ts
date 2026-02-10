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
import * as readline from 'node:readline';
import chalk from 'chalk';
import { ensureDefaultPlan, loadTestPlan } from '../testing/plans.js';
import { executeTestPlan } from '../testing/executor.js';
import { persistRunResult } from '../testing/persistence.js';
import { loadBaseline, saveBaseline } from '../testing/baselines.js';
import { compareRuns } from '../testing/compare.js';
import type { RunComparison } from '../testing/compare.js';
import type { TestRunResult } from '../testing/types.js';
import type { ExecutionPlan } from '../types.js';
import { createFailureSummary } from '../testing/failure-summary.js';
import { runVisualJudge } from '../testing/visual-judge.js';
import { attemptAutoFix } from '../testing/auto-fix.js';
import { applyPlan, readFileIfExists } from '../fs/writer.js';
import { requestFileContent } from '../gemini/client.js';
import { scanRepository } from '../repo/scanner.js';
import { createRepoSummary } from '../repo/summarizer.js';
import { detectProject, runBuild, startPreviewServer, PREVIEW_PORT } from './shared.js';
import { loadFeatureIntent } from '../intent/feature-intent.js';

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

  // Load and display feature intent if available
  const featureIntent = await loadFeatureIntent(cwd);
  if (featureIntent) {
    const truncated = featureIntent.intent.length > 120
      ? featureIntent.intent.slice(0, 117) + '...'
      : featureIntent.intent;
    console.log(chalk.dim(`  Feature intent: ${truncated}`));
  }

  // Step 1: Ensure default plan exists and load the requested plan
  await ensureDefaultPlan(cwd);

  let plan;
  try {
    plan = await loadTestPlan(resolvedPlanName, cwd);
  } catch (error) {
    console.log(chalk.red(`\n  ${(error as Error).message}\n`));
    return null;
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
    return null;
  }

  console.log(chalk.green('  Detected React + Vite project'));

  // Step 3: Build
  const buildSuccess = await runBuild(cwd);
  if (!buildSuccess) {
    console.log(chalk.red('\n  Build failed. Aborting.\n'));
    return null;
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

    // ── Visual judge (diagnostic-only, never blocks) ──
    if (process.env.GEMINI_API_KEY) {
      const judgeResult = await runVisualJudge({ cwd, runDir, testPlan: plan });

      if (judgeResult && judgeResult.issues.length > 0) {
        await writeJson(join(runDir, 'visual-issues.json'), judgeResult.issues, { spaces: 2 });

        if (failureSummary) {
          failureSummary.visualIssues = judgeResult.issues;
          await writeJson(join(runDir, 'failure-summary.json'), failureSummary, { spaces: 2 });
        }

        console.log(chalk.dim(`  Visual judge detected ${judgeResult.issues.length} potential UI issue(s)`));
      }
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

// ── Auto-fix loop ──────────────────────────────────────────────────

/**
 * Run the test command in a loop, attempting LLM-driven fixes when
 * tests fail. Each iteration: test → diagnose → propose fix → approve
 * → apply → re-test. The loop stops when tests pass, the user rejects
 * a fix, the LLM can't produce a plan, or maxAttempts is reached.
 *
 * Requires GEMINI_API_KEY since fix proposals use the Gemini LLM.
 */
export async function runFixLoop(
  planName: string,
  maxAttempts: number,
): Promise<TestRunResult | null> {
  const cwd = process.cwd();

  if (!process.env.GEMINI_API_KEY) {
    console.log(chalk.red('\n  --fix requires GEMINI_API_KEY to be set.'));
    console.log(chalk.dim('  Set it with: export GEMINI_API_KEY=your_api_key\n'));
    return null;
  }

  let lastResult: TestRunResult | null = null;

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    // attempt 0 = initial run, 1..maxAttempts = fix attempts
    if (attempt > 0) {
      console.log(chalk.cyan.bold(`\n  ── Fix attempt ${attempt}/${maxAttempts} ──────────────────────────────\n`));
    }

    lastResult = await testCommand(planName, false);

    // Terminal error (plan not found, detection failed, build failed)
    if (!lastResult) {
      if (attempt > 0) {
        console.log(chalk.red('  Build or execution failed after applying fix. Stopping.\n'));
      }
      return null;
    }

    // Tests passed
    if (lastResult.status === 'passed') {
      if (attempt > 0) {
        console.log(chalk.green.bold(`\n  Fix succeeded on attempt ${attempt}!\n`));
      }
      return lastResult;
    }

    // Tests failed — check if we have fix attempts left
    if (attempt >= maxAttempts) {
      console.log(chalk.red(`\n  Max fix attempts (${maxAttempts}) reached. Stopping.\n`));
      break;
    }

    // Generate fix proposal
    console.log(chalk.cyan(`\n  Generating fix proposal (attempt ${attempt + 1}/${maxAttempts})...`));

    const fixResult = await attemptAutoFix({
      planName,
      runTimestamp: lastResult.timestamp,
      cwd,
    });

    if (fixResult.status !== 'proposed') {
      console.log(chalk.red(`\n  Auto-fix could not produce a plan: ${fixResult.status}`));
      if (fixResult.status === 'error') {
        console.log(chalk.red(`  ${fixResult.message}`));
      }
      break;
    }

    // Display proposed plan and ask for approval
    displayFixPlan(fixResult.plan);

    const approved = await askFixApproval();
    if (!approved) {
      console.log(chalk.dim('\n  Fix rejected. Stopping.\n'));
      break;
    }

    // Apply the plan
    console.log(chalk.cyan('\n  Applying fix...'));
    const applied = await applyFixPlan(fixResult.plan, cwd);
    if (!applied) {
      console.log(chalk.red('\n  Failed to apply fix. Stopping.\n'));
      break;
    }

    // Loop back to re-run test
  }

  return lastResult;
}

/**
 * Display a proposed ExecutionPlan in the terminal.
 */
function displayFixPlan(plan: ExecutionPlan): void {
  console.log(chalk.cyan.bold('\n  Proposed Fix'));
  console.log(chalk.dim(`  Reasoning: ${plan.reasoning}\n`));

  if (plan.files_to_create.length > 0) {
    console.log(chalk.green('  Files to create:'));
    for (const f of plan.files_to_create) {
      console.log(chalk.green(`    + ${f.path}`));
      console.log(chalk.dim(`      ${f.description}`));
    }
  }

  if (plan.files_to_modify.length > 0) {
    console.log(chalk.yellow('  Files to modify:'));
    for (const f of plan.files_to_modify) {
      console.log(chalk.yellow(`    ~ ${f.path}`));
      console.log(chalk.dim(`      ${f.description}`));
    }
  }

  if (plan.files_to_delete.length > 0) {
    console.log(chalk.red('  Files to delete:'));
    for (const f of plan.files_to_delete) {
      console.log(chalk.red(`    - ${f}`));
    }
  }
}

/**
 * Prompt the user to approve or reject a proposed fix.
 */
function askFixApproval(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(chalk.cyan('\n  Apply this fix? (y/n) '), (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

/**
 * Apply an ExecutionPlan by requesting file content from Gemini
 * and writing changes via the existing applyPlan pipeline.
 * Returns true if changes were successfully written.
 */
async function applyFixPlan(
  plan: ExecutionPlan,
  cwd: string,
): Promise<boolean> {
  // Scan repo for context (needed by requestFileContent)
  const repoContext = await scanRepository(cwd);
  const repoSummary = createRepoSummary(repoContext);

  const getFileContent = async (filePath: string): Promise<string> => {
    const createEntry = plan.files_to_create.find(f => f.path === filePath);
    const modifyEntry = plan.files_to_modify.find(f => f.path === filePath);
    const description = createEntry?.description ?? modifyEntry?.description ?? 'Fix test failure';

    let existingContent: string | undefined;
    if (modifyEntry) {
      const existing = await readFileIfExists(join(cwd, filePath));
      existingContent = existing ?? undefined;
    }

    return requestFileContent(filePath, description, [], repoSummary, existingContent);
  };

  try {
    const result = await applyPlan(plan, cwd, getFileContent);

    if (result.hasValidationErrors) {
      console.log(chalk.yellow('\n  Validation errors in generated code:'));
      for (const vr of result.validationResults) {
        if (!vr.isValid) {
          for (const err of vr.errors) {
            console.log(chalk.yellow(`    ${vr.filePath}:${err.line}: ${err.message}`));
          }
        }
      }
      console.log(chalk.yellow('  Fix was not applied due to syntax errors.'));
      return false;
    }

    if (result.diffHistory.diffs.length > 0) {
      console.log(chalk.green(`\n  Applied ${result.diffHistory.diffs.length} file change(s):`));
      for (const diff of result.diffHistory.diffs) {
        const op = diff.operation === 'create' ? '+' : diff.operation === 'modify' ? '~' : '-';
        console.log(chalk.dim(`    ${op} ${diff.path}`));
      }
    } else {
      console.log(chalk.yellow('\n  No file changes produced.'));
      return false;
    }

    return true;
  } catch (error) {
    console.log(chalk.red(`\n  Error applying fix: ${(error as Error).message}`));
    return false;
  }
}
