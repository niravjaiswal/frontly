export interface ConsoleMessage {
  type: 'log' | 'warn' | 'error';
  message: string;
}

export interface UncaughtError {
  message: string;
  stack?: string;
}

export interface FrontlyBrowserArtifacts {
  screenshotBase64: string;
  domSnapshot: string;
  consoleMessages: ConsoleMessage[];
  uncaughtErrors: UncaughtError[];
}
