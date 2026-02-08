/**
 * Discover Command
 *
 * Uses Stagehand with LLM-powered observe() and act() to explore
 * a running build of the user's app, captures browser interactions,
 * and converts the trace into a deterministic TestPlan.
 *
 * LLM calls happen ONLY here — never during test execution.
 */

import { Stagehand } from '@browserbasehq/stagehand';
import type { AvailableModel, ClientOptions } from '@browserbasehq/stagehand';
import chalk from 'chalk';
import { createInterface } from 'node:readline/promises';
import { type ExecaError } from 'execa';
import { detectProject, runBuild, startPreviewServer, PREVIEW_PORT } from './shared.js';
import { createTraceCollector } from '../testing/trace.js';
import { traceToPlan } from '../testing/trace-to-plan.js';
import { saveTestPlan, planExists } from '../testing/plans.js';

const MAX_EXPLORATION_STEPS = 10;

interface LLMConfig {
  modelName: AvailableModel;
  modelClientOptions: ClientOptions;
  provider: string;
}

/**
 * Resolve the LLM provider configuration for Stagehand.
 * Checks ANTHROPIC_API_KEY first, then OPENAI_API_KEY.
 */
function resolveLLMConfig(): LLMConfig {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      modelName: 'claude-3-7-sonnet-latest',
      modelClientOptions: { apiKey: process.env.ANTHROPIC_API_KEY },
      provider: 'Anthropic (Claude 3.7 Sonnet)',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      modelName: 'gpt-4o',
      modelClientOptions: { apiKey: process.env.OPENAI_API_KEY },
      provider: 'OpenAI (GPT-4o)',
    };
  }
  throw new Error(
    'No LLM API key found.\n' +
    '  Set ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable.\n' +
    '  The discover command uses an LLM to explore your application.'
  );
}

/**
 * Convert an intent string to a kebab-case plan name.
 */
function derivePlanName(intent: string): string {
  return intent
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50);
}

/**
 * Prompt the user to confirm overwriting an existing plan.
 */
async function promptOverwrite(planName: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      chalk.yellow(`\n  Plan "${planName}" already exists. Overwrite? (y/N) `)
    );
    return answer.trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

/**
 * Format a step for display in the summary.
 */
function formatStep(step: { type: string; [key: string]: unknown }): string {
  switch (step.type) {
    case 'navigate':
      return `Navigate to ${step.url}`;
    case 'assertRoute':
      return `Assert route is ${step.path}`;
    case 'click':
      return `Click: ${step.description}`;
    case 'fill':
      return `Fill: ${step.description} with "${step.value}"`;
    default:
      return `${step.type}`;
  }
}

/**
 * Main discover command handler.
 *
 * Builds and serves the project, then uses Stagehand with LLM
 * to explore the app and generate a deterministic TestPlan.
 */
export async function discoverCommand(intent: string): Promise<void> {
  const cwd = process.cwd();

  console.log(chalk.cyan.bold('\n  Frontly Discover'));
  console.log(chalk.dim('  AI-powered test plan generation\n'));

  // Step 1: Resolve LLM config (fail fast)
  const llmConfig = resolveLLMConfig();
  console.log(chalk.dim(`  LLM: ${llmConfig.provider}`));
  console.log(chalk.dim(`  Intent: "${intent}"\n`));

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

  let stagehand: Stagehand | null = null;

  try {
    // Step 5: Create Stagehand with LLM enabled
    console.log(chalk.cyan('\n  Launching browser for exploration...'));

    stagehand = new Stagehand({
      env: 'LOCAL',
      enableCaching: false,
      headless: true,
      modelName: llmConfig.modelName,
      modelClientOptions: llmConfig.modelClientOptions,
      verbose: 0,
    });

    await stagehand.init();
    const page = stagehand.page;

    // Step 6: Install trace collector
    const collector = createTraceCollector();
    await collector.install(page);

    // Step 7: Navigate to app root
    const baseUrl = `http://localhost:${PREVIEW_PORT}`;
    console.log(chalk.dim(`  Navigating to ${baseUrl}...`));
    await page.goto(baseUrl, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(1_000);

    // Step 8: Exploration loop
    console.log(chalk.cyan('\n  Exploring application...\n'));
    let staleIterations = 0;
    let prevEventCount = collector.events.length;

    for (let i = 0; i < MAX_EXPLORATION_STEPS; i++) {
      console.log(chalk.dim(`  Step ${i + 1}/${MAX_EXPLORATION_STEPS}: Observing...`));

      const observations = await page.observe();
      if (observations.length === 0) {
        console.log(chalk.dim('  No interactive elements found. Exploration complete.'));
        break;
      }

      console.log(chalk.dim(`  Found ${observations.length} elements. Acting on intent...`));
      const result = await page.act({ action: intent });

      if (!result.success) {
        console.log(chalk.dim(`  Exploration ended: ${result.message}`));
        break;
      }

      console.log(chalk.dim(`  Action: ${result.action}`));

      // Check for stale iterations (no new trace events)
      if (collector.events.length === prevEventCount) {
        staleIterations++;
        if (staleIterations >= 2) {
          console.log(chalk.dim('  No new interactions detected. Exploration complete.'));
          break;
        }
      } else {
        staleIterations = 0;
      }
      prevEventCount = collector.events.length;
    }

    // Step 9: Close browser
    await stagehand.close();
    stagehand = null;

    console.log(chalk.dim(`\n  Captured ${collector.events.length} trace events`));

    // Step 10: Convert trace to plan
    const planName = derivePlanName(intent);
    const plan = traceToPlan(collector.events, intent, planName);

    // Step 11: Check for existing plan
    if (await planExists(planName, cwd)) {
      const overwrite = await promptOverwrite(planName);
      if (!overwrite) {
        console.log(chalk.dim('\n  Cancelled. Plan not saved.\n'));
        return;
      }
    }

    // Step 12: Save plan
    const filePath = await saveTestPlan(plan, cwd);

    // Step 13: Print summary
    console.log(chalk.green.bold(`\n  Test plan generated: ${planName}`));
    console.log(chalk.dim(`  Intent: "${intent}"`));
    console.log(chalk.dim(`  Steps: ${plan.steps.length}`));
    console.log(chalk.dim(`  Checkpoints: ${plan.visualCheckpoints.length}`));
    console.log(chalk.dim(`  File: ${filePath}\n`));

    console.log(chalk.dim('  Steps:'));
    for (const [i, step] of plan.steps.entries()) {
      console.log(chalk.dim(`    ${i + 1}. ${formatStep(step)}`));
    }

    console.log(chalk.dim('\n  Checkpoints:'));
    for (const cp of plan.visualCheckpoints) {
      console.log(chalk.dim(`    - "${cp.name}" (after step ${cp.afterStep + 1})`));
    }

    console.log(chalk.cyan(`\n  Run with: frontly test --plan ${planName}\n`));
  } catch (error) {
    console.error(chalk.red(`\n  Discovery failed: ${(error as Error).message}\n`));
    process.exit(1);
  } finally {
    // Cleanup: close browser if still open
    if (stagehand) {
      try { await stagehand.close(); } catch { /* ignore */ }
    }

    // Cleanup: kill server
    serverProcess.kill('SIGTERM');
    try {
      await serverProcess;
    } catch (error) {
      const execaError = error as ExecaError;
      if (execaError.exitCode !== 143) {
        throw error;
      }
    }
    console.log(chalk.dim('  Server stopped.\n'));
  }
}
