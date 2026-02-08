import type { Stagehand } from '@browserbasehq/stagehand';
import type { VisualAssertion, VisualAssertionResult } from './types.js';

type Page = Stagehand['page'];

async function assertElementVisible(
  page: Page,
  assertion: Extract<VisualAssertion, { type: 'elementVisible' }>
): Promise<VisualAssertionResult> {
  try {
    const locator = page.locator(assertion.selector);
    const count = await locator.count();
    if (count === 0) {
      return { assertion, status: 'failed', message: `Element "${assertion.selector}" not found` };
    }

    const box = await locator.first().boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) {
      return { assertion, status: 'failed', message: `Element "${assertion.selector}" has no visible dimensions` };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hidden = await locator.first().evaluate((el: any) => {
      const style = (globalThis as any).getComputedStyle(el);
      return style.display === 'none' || style.visibility === 'hidden';
    });
    if (hidden) {
      return { assertion, status: 'failed', message: `Element "${assertion.selector}" is hidden via CSS` };
    }

    return { assertion, status: 'passed', message: 'Element is visible' };
  } catch (error) {
    return { assertion, status: 'failed', message: (error as Error).message };
  }
}

async function assertElementInViewport(
  page: Page,
  assertion: Extract<VisualAssertion, { type: 'elementInViewport' }>
): Promise<VisualAssertionResult> {
  try {
    const locator = page.locator(assertion.selector);
    const count = await locator.count();
    if (count === 0) {
      return { assertion, status: 'failed', message: `Element "${assertion.selector}" not found` };
    }

    const box = await locator.first().boundingBox();
    if (!box) {
      return { assertion, status: 'failed', message: `Element "${assertion.selector}" has no bounding box` };
    }

    const viewport = page.viewportSize();
    if (!viewport) {
      return { assertion, status: 'failed', message: 'Could not determine viewport size' };
    }

    const inViewport =
      box.x + box.width > 0 &&
      box.y + box.height > 0 &&
      box.x < viewport.width &&
      box.y < viewport.height;

    if (!inViewport) {
      return { assertion, status: 'failed', message: `Element "${assertion.selector}" is outside the viewport` };
    }

    return { assertion, status: 'passed', message: 'Element is in viewport' };
  } catch (error) {
    return { assertion, status: 'failed', message: (error as Error).message };
  }
}

async function assertElementNotOverlapped(
  page: Page,
  assertion: Extract<VisualAssertion, { type: 'elementNotOverlapped' }>
): Promise<VisualAssertionResult> {
  try {
    const locator = page.locator(assertion.selector);
    const count = await locator.count();
    if (count === 0) {
      return { assertion, status: 'failed', message: `Element "${assertion.selector}" not found` };
    }

    const box = await locator.first().boundingBox();
    if (!box) {
      return { assertion, status: 'failed', message: `Element "${assertion.selector}" has no bounding box` };
    }

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isTargetOrDescendant = await locator.first().evaluate(
      (el: any, point: any) => {
        const doc = (globalThis as any).document;
        const topEl = doc.elementFromPoint(point.x, point.y);
        return topEl !== null && (el === topEl || el.contains(topEl));
      },
      { x: cx, y: cy }
    );

    if (!isTargetOrDescendant) {
      return { assertion, status: 'failed', message: `Element "${assertion.selector}" is overlapped at its center point` };
    }

    return { assertion, status: 'passed', message: 'Element is not overlapped' };
  } catch (error) {
    return { assertion, status: 'failed', message: (error as Error).message };
  }
}

async function assertMinSize(
  page: Page,
  assertion: Extract<VisualAssertion, { type: 'minSize' }>
): Promise<VisualAssertionResult> {
  try {
    const locator = page.locator(assertion.selector);
    const count = await locator.count();
    if (count === 0) {
      return { assertion, status: 'failed', message: `Element "${assertion.selector}" not found` };
    }

    const box = await locator.first().boundingBox();
    if (!box) {
      return { assertion, status: 'failed', message: `Element "${assertion.selector}" has no bounding box` };
    }

    if (box.width < assertion.minWidth || box.height < assertion.minHeight) {
      return {
        assertion,
        status: 'failed',
        message: `Element "${assertion.selector}" is ${box.width}x${box.height}, expected at least ${assertion.minWidth}x${assertion.minHeight}`,
      };
    }

    return { assertion, status: 'passed', message: `Element meets minimum size (${box.width}x${box.height})` };
  } catch (error) {
    return { assertion, status: 'failed', message: (error as Error).message };
  }
}

async function assertNoHorizontalOverflow(
  page: Page,
  assertion: Extract<VisualAssertion, { type: 'noHorizontalOverflow' }>
): Promise<VisualAssertionResult> {
  try {
    const viewport = page.viewportSize();
    if (!viewport) {
      return { assertion, status: 'failed', message: 'Could not determine viewport size' };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scrollWidth: number = await page.evaluate(() => (globalThis as any).document.documentElement.scrollWidth);

    if (scrollWidth > viewport.width) {
      return {
        assertion,
        status: 'failed',
        message: `Page has horizontal overflow: scrollWidth ${scrollWidth}px > viewport ${viewport.width}px`,
      };
    }

    return { assertion, status: 'passed', message: 'No horizontal overflow' };
  } catch (error) {
    return { assertion, status: 'failed', message: (error as Error).message };
  }
}

export async function executeVisualAssertions(
  page: Page,
  assertions: VisualAssertion[]
): Promise<VisualAssertionResult[]> {
  const results: VisualAssertionResult[] = [];

  for (const assertion of assertions) {
    let result: VisualAssertionResult;
    switch (assertion.type) {
      case 'elementVisible':
        result = await assertElementVisible(page, assertion);
        break;
      case 'elementInViewport':
        result = await assertElementInViewport(page, assertion);
        break;
      case 'elementNotOverlapped':
        result = await assertElementNotOverlapped(page, assertion);
        break;
      case 'minSize':
        result = await assertMinSize(page, assertion);
        break;
      case 'noHorizontalOverflow':
        result = await assertNoHorizontalOverflow(page, assertion);
        break;
    }
    results.push(result);
  }

  return results;
}
