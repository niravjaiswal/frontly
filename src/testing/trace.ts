/**
 * Trace Capture
 *
 * Instruments a Stagehand/Playwright page to capture DOM interactions
 * (clicks, form fills, navigations) into an in-memory array.
 *
 * Uses page.exposeFunction() + page.addInitScript() so that event
 * listeners survive cross-page navigations.
 */

import type { ElementAttributes } from './selectors.js';

export interface TraceEvent {
  type: 'click' | 'fill' | 'navigate' | 'routeChange';
  timestamp: number;
  url: string;
  element?: ElementAttributes;
  value?: string;
}

export interface TraceCollector {
  events: TraceEvent[];
  install: (page: TracablePage) => Promise<void>;
}

/**
 * Minimal page interface for trace instrumentation.
 * Compatible with both Stagehand's Page and Playwright's Page.
 */
interface TracablePage {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exposeFunction(name: string, callback: (...args: any[]) => any): Promise<void>;
  addInitScript(script: { content: string }): Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): any;
  url(): string;
}

/**
 * Create a TraceCollector that captures browser interactions.
 *
 * Call `collector.install(page)` before navigating or calling act().
 * All captured events accumulate in `collector.events`.
 */
export function createTraceCollector(): TraceCollector {
  const events: TraceEvent[] = [];

  async function install(page: TracablePage): Promise<void> {
    // Expose a bridge function that page-level JS calls to report events.
    // This binding survives navigations.
    await page.exposeFunction(
      '__frontlyReport',
      (serialized: string) => {
        try {
          const event = JSON.parse(serialized) as TraceEvent;
          events.push(event);
        } catch {
          // Ignore malformed events
        }
      }
    );

    // Inject event listeners that re-register on every navigation.
    // The script runs in the browser context — must be plain JS, no imports.
    await page.addInitScript({
      content: `
        (function() {
          var debounceTimers = {};

          document.addEventListener('click', function(e) {
            var el = e.target;
            while (el && el.nodeType !== 1) el = el.parentElement;
            if (!el) return;

            var event = {
              type: 'click',
              timestamp: Date.now(),
              url: window.location.href,
              element: {
                tagName: el.tagName || '',
                testId: el.getAttribute('data-testid') || undefined,
                ariaLabel: el.getAttribute('aria-label') || undefined,
                role: el.getAttribute('role') || undefined,
                textContent: (el.innerText || '').trim().slice(0, 80) || undefined,
                name: el.getAttribute('name') || undefined,
                placeholder: el.getAttribute('placeholder') || undefined,
                type: el.getAttribute('type') || undefined,
                href: el.closest('a') ? el.closest('a').getAttribute('href') : undefined
              }
            };
            window.__frontlyReport(JSON.stringify(event));
          }, true);

          document.addEventListener('input', function(e) {
            var el = e.target;
            if (!el || !el.tagName) return;
            var tag = el.tagName.toLowerCase();
            if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;

            var key = (el.getAttribute('name') || el.getAttribute('data-testid') || 'unnamed');
            clearTimeout(debounceTimers[key]);
            debounceTimers[key] = setTimeout(function() {
              var event = {
                type: 'fill',
                timestamp: Date.now(),
                url: window.location.href,
                value: el.value || '',
                element: {
                  tagName: el.tagName || '',
                  testId: el.getAttribute('data-testid') || undefined,
                  ariaLabel: el.getAttribute('aria-label') || undefined,
                  role: el.getAttribute('role') || undefined,
                  textContent: undefined,
                  name: el.getAttribute('name') || undefined,
                  placeholder: el.getAttribute('placeholder') || undefined,
                  type: el.getAttribute('type') || undefined,
                  href: undefined
                }
              };
              window.__frontlyReport(JSON.stringify(event));
            }, 300);
          }, true);
        })();
      `,
    });

    // Capture navigation events at the Playwright level.
    page.on('framenavigated', (frame: { url: () => string; parentFrame: () => unknown }) => {
      // Only track main-frame navigations
      if (frame.parentFrame() !== null) return;
      events.push({
        type: 'navigate',
        timestamp: Date.now(),
        url: frame.url(),
      });
    });
  }

  return { events, install };
}
