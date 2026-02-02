/**
 * Diff Module
 *
 * Handles creating and displaying file diffs for tracking changes.
 */

import * as Diff from 'diff';
import type { FileDiff } from '../types.js';

/**
 * Creates a unified diff between two strings
 */
export function createUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string
): string {
  const diff = Diff.createTwoFilesPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    oldContent,
    newContent,
    '',
    ''
  );
  return diff;
}

/**
 * Creates a FileDiff object for a file operation
 */
export function createFileDiff(
  path: string,
  operation: 'create' | 'modify' | 'delete',
  before: string | null,
  after: string
): FileDiff {
  return {
    path,
    before,
    after,
    operation,
  };
}

/**
 * Formats a FileDiff for display in the terminal
 */
export function formatDiffForDisplay(diff: FileDiff): string {
  const lines: string[] = [];

  const operationColors = {
    create: '+',
    modify: '~',
    delete: '-',
  };

  lines.push(`${operationColors[diff.operation]} ${diff.path}`);

  if (diff.operation === 'delete') {
    lines.push('  (file deleted)');
    return lines.join('\n');
  }

  if (diff.operation === 'create') {
    // Show a preview of new file content
    const preview = diff.after.split('\n').slice(0, 10);
    for (const line of preview) {
      lines.push(`  + ${line}`);
    }
    if (diff.after.split('\n').length > 10) {
      lines.push('  + ... (more lines)');
    }
    return lines.join('\n');
  }

  // For modifications, show a proper diff
  if (diff.before !== null) {
    const unifiedDiff = createUnifiedDiff(diff.path, diff.before, diff.after);
    const diffLines = unifiedDiff.split('\n').slice(2); // Skip header lines

    for (const line of diffLines.slice(0, 20)) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        lines.push(`  ${line}`);
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        lines.push(`  ${line}`);
      } else if (line.startsWith('@')) {
        lines.push(`  ${line}`);
      }
    }

    if (diffLines.length > 20) {
      lines.push('  ... (more changes)');
    }
  }

  return lines.join('\n');
}

/**
 * Summarizes multiple diffs for display
 */
export function summarizeDiffs(diffs: FileDiff[]): string {
  const lines: string[] = [];

  const created = diffs.filter((d) => d.operation === 'create');
  const modified = diffs.filter((d) => d.operation === 'modify');
  const deleted = diffs.filter((d) => d.operation === 'delete');

  if (created.length > 0) {
    lines.push(`Created ${created.length} file(s):`);
    for (const diff of created) {
      lines.push(`  + ${diff.path}`);
    }
  }

  if (modified.length > 0) {
    lines.push(`Modified ${modified.length} file(s):`);
    for (const diff of modified) {
      lines.push(`  ~ ${diff.path}`);
    }
  }

  if (deleted.length > 0) {
    lines.push(`Deleted ${deleted.length} file(s):`);
    for (const diff of deleted) {
      lines.push(`  - ${diff.path}`);
    }
  }

  return lines.join('\n');
}
