/**
 * Trace-to-Plan Converter
 *
 * Converts raw TraceEvent[] captured during Stagehand exploration
 * into a deterministic TestPlan suitable for replay by `frontly test`.
 */

import type { TestPlan, TestStep, VisualCheckpoint } from './types.js';
import type { TraceEvent } from './trace.js';
import { computeSelector } from './selectors.js';

/**
 * Build a human-readable description for a click step.
 */
function clickDescription(event: TraceEvent): string {
  const el = event.element;
  if (!el) return 'Click element';
  const text = el.textContent ? ` "${el.textContent}"` : '';
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return `Click link${text}`;
  if (tag === 'button') return `Click button${text}`;
  return `Click ${tag}${text}`;
}

/**
 * Build a human-readable description for a fill step.
 */
function fillDescription(event: TraceEvent): string {
  const el = event.element;
  if (!el) return 'Fill field';
  const label = el.ariaLabel || el.placeholder || el.name || el.type || 'field';
  return `Fill ${label}`;
}

/**
 * Extract the pathname from a URL string, returning '/' on failure.
 */
function extractPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '/';
  }
}

/**
 * Deduplicate consecutive events that are identical within a time window.
 */
function deduplicateEvents(events: TraceEvent[]): TraceEvent[] {
  const DEDUP_WINDOW_MS = 500;
  const result: TraceEvent[] = [];

  for (const event of events) {
    const prev = result[result.length - 1];
    if (!prev) {
      result.push(event);
      continue;
    }

    // Skip duplicate consecutive events of the same type within window
    if (
      event.type === prev.type &&
      Math.abs(event.timestamp - prev.timestamp) < DEDUP_WINDOW_MS
    ) {
      if (event.type === 'click' && prev.type === 'click') {
        const sameElement =
          event.element?.testId === prev.element?.testId &&
          event.element?.textContent === prev.element?.textContent &&
          event.element?.tagName === prev.element?.tagName;
        if (sameElement) continue;
      }
      if (event.type === 'navigate' && prev.type === 'navigate') {
        if (event.url === prev.url) continue;
      }
    }

    result.push(event);
  }

  return result;
}

/**
 * Convert a list of trace events into a TestPlan.
 *
 * Steps are constructed by mapping each trace event to one or more
 * deterministic TestStep entries. Visual checkpoints are placed at
 * key state transitions.
 */
export function traceToPlan(
  rawEvents: TraceEvent[],
  intent: string,
  planName: string
): TestPlan {
  const events = deduplicateEvents(rawEvents);
  const steps: TestStep[] = [];
  let lastPathname = '/';

  // Always start with a navigation to root
  steps.push({ type: 'navigate', url: '/' });

  for (const event of events) {
    switch (event.type) {
      case 'navigate':
      case 'routeChange': {
        const pathname = extractPathname(event.url);
        // Skip if this is the initial navigation to root (we already added it)
        if (steps.length === 1 && pathname === '/') continue;
        // Skip if route hasn't changed
        if (pathname === lastPathname) continue;

        steps.push({ type: 'navigate', url: pathname });
        steps.push({ type: 'assertRoute', path: pathname });
        lastPathname = pathname;
        break;
      }

      case 'click': {
        if (!event.element) break;
        const selector = computeSelector(event.element);
        steps.push({
          type: 'click',
          selector,
          description: clickDescription(event),
        });
        break;
      }

      case 'fill': {
        if (!event.element || !event.value) break;
        const selector = computeSelector(event.element);
        steps.push({
          type: 'fill',
          selector,
          value: event.value,
          description: fillDescription(event),
        });
        break;
      }
    }
  }

  // Generate visual checkpoints at key moments
  const checkpoints: VisualCheckpoint[] = [];

  if (steps.length > 0) {
    // Checkpoint after the first step (initial state)
    checkpoints.push({ name: 'initial-state', afterStep: 0 });

    // Checkpoints after route changes
    for (let i = 1; i < steps.length; i++) {
      if (steps[i].type === 'assertRoute') {
        const step = steps[i] as { type: 'assertRoute'; path: string };
        const name = `after-${step.path.replace(/^\//, '').replace(/\//g, '-') || 'root'}`;
        checkpoints.push({ name, afterStep: i });
      }
    }

    // Checkpoint after the last step (final state), if not already covered
    const lastIdx = steps.length - 1;
    if (!checkpoints.some((cp) => cp.afterStep === lastIdx)) {
      checkpoints.push({ name: 'final-state', afterStep: lastIdx });
    }
  }

  return {
    name: planName,
    intent,
    steps,
    visualCheckpoints: checkpoints,
  };
}
