/**
 * Stable Selector Computation
 *
 * Given a DOM element's attributes (captured via trace instrumentation),
 * computes the most stable Playwright-compatible selector string.
 *
 * Priority: data-testid > aria-label > role+text > button/link text
 *           > input name/placeholder > tagName fallback
 */

export interface ElementAttributes {
  tagName: string;
  testId?: string;
  ariaLabel?: string;
  role?: string;
  textContent?: string;
  name?: string;
  placeholder?: string;
  type?: string;
  href?: string;
}

function escapeCSS(value: string): string {
  return value.replace(/"/g, '\\"');
}

export function computeSelector(attrs: ElementAttributes): string {
  const tag = attrs.tagName.toLowerCase();

  if (attrs.testId) {
    return `[data-testid="${escapeCSS(attrs.testId)}"]`;
  }

  if (attrs.ariaLabel) {
    return `[aria-label="${escapeCSS(attrs.ariaLabel)}"]`;
  }

  if (attrs.role && attrs.textContent) {
    return `role=${attrs.role}[name="${escapeCSS(attrs.textContent)}"]`;
  }

  if ((tag === 'a' || tag === 'button') && attrs.textContent) {
    return `text=${attrs.textContent}`;
  }

  if (tag === 'input' && attrs.name) {
    return `input[name="${escapeCSS(attrs.name)}"]`;
  }

  if (tag === 'input' && attrs.placeholder) {
    return `input[placeholder="${escapeCSS(attrs.placeholder)}"]`;
  }

  return tag;
}
