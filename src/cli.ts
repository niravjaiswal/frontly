#!/usr/bin/env node
/**
 * Frontly CLI Entry Point
 *
 * This is the main entry point for the frontly command.
 * It sets up the CLI using commander and launches the interactive chat UI.
 */

import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { App } from './ui/App.js';
import { scanRepository } from './repo/scanner.js';
import { createRepoSummary } from './repo/summarizer.js';
import { testCommand } from './commands/test.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('frontly')
  .description('AI-powered CLI tool for creating and editing React + Vite frontend projects')
  .version('1.0.0')
  .option('-d, --debug', 'Enable debug mode')
  .action(async (options) => {
    const cwd = process.cwd();

    // Display startup banner
    console.log(chalk.cyan.bold('\n  ⚡ Frontly'));
    console.log(chalk.dim('  AI-powered React + Vite development\n'));

    // Check for API key
    if (!process.env.GEMINI_API_KEY) {
      console.log(chalk.red('Error: GEMINI_API_KEY environment variable is not set.'));
      console.log(chalk.dim('Set it with: export GEMINI_API_KEY=your_api_key\n'));
      process.exit(1);
    }

    // Scan repository context
    console.log(chalk.dim('  Scanning repository...'));
    const repoContext = await scanRepository(cwd);
    const summary = createRepoSummary(repoContext);

    if (repoContext.hasReactApp) {
      console.log(chalk.green('  ✓ Detected React application'));
    }
    if (repoContext.hasVite) {
      console.log(chalk.green('  ✓ Detected Vite configuration'));
    }
    if (!repoContext.hasReactApp && !repoContext.hasVite) {
      console.log(chalk.yellow('  ⚠ No existing React/Vite project detected'));
      console.log(chalk.dim('    Ask me to scaffold a new Vite + React app!\n'));
    }

    console.log(chalk.dim('\n  Type your message and press Enter to chat.'));
    console.log(chalk.dim('  Commands: /exit, /clear, /diff\n'));

    // Clear the console and render the Ink app
    const { waitUntilExit } = render(
      React.createElement(App, {
        repoContext,
        repoSummary: summary,
        debug: options.debug ?? false,
      })
    );

    await waitUntilExit();
    console.log(chalk.dim('\n  Goodbye!\n'));
  });

program
  .command('test')
  .description('Run a test plan against the production build')
  .option('-p, --plan <name>', 'Test plan to run', 'smoke')
  .action(async (options: { plan: string }) => {
    const result = await testCommand(options.plan);

    if (result) {
      process.exit(result.status === 'passed' ? 0 : 1);
    } else {
      process.exit(1);
    }
  });

program.parse();
