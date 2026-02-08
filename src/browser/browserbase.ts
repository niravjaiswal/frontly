import { Stagehand } from '@browserbasehq/stagehand';
import type { ConsoleMessage, UncaughtError } from './types.js';

export type BrowserSession = {
  page: Stagehand['page'];
  consoleMessages: ConsoleMessage[];
  uncaughtErrors: UncaughtError[];
  close: () => Promise<void>;
};

/**
 * Create a headless browser session using Stagehand in LOCAL mode.
 * No remote providers, no LLM calls — purely deterministic.
 *
 * The caller owns the session and must call `close()` when done.
 * Console messages and uncaught errors are collected automatically.
 */
export async function createBrowserSession(): Promise<BrowserSession> {
  const consoleMessages: ConsoleMessage[] = [];
  const uncaughtErrors: UncaughtError[] = [];

  const stagehand = new Stagehand({
    env: 'LOCAL',
    enableCaching: false,
    headless: true,
  });

  await stagehand.init();

  const page = stagehand.page;

  // Collect console messages
  page.on('console', (msg: { type: () => string; text: () => string }) => {
    const type = msg.type();
    if (type === 'log' || type === 'warning' || type === 'error') {
      consoleMessages.push({
        type: type === 'warning' ? 'warn' : (type as 'log' | 'error'),
        message: msg.text(),
      });
    }
  });

  // Collect uncaught errors
  page.on('pageerror', (error: Error) => {
    uncaughtErrors.push({
      message: error.message,
      stack: error.stack,
    });
  });

  return {
    page,
    consoleMessages,
    uncaughtErrors,
    close: () => stagehand.close(),
  };
}
