/**
 * Repository Summarizer
 *
 * Creates a compact textual summary of the repository for the LLM context.
 */

import type { RepoContext, FileTreeNode } from '../types.js';

/**
 * Creates a textual summary of the repository context
 */
export function createRepoSummary(context: RepoContext): string {
  const sections: string[] = [];

  // Project overview
  sections.push('## Project Overview');
  if (context.packageJson) {
    sections.push(`- Name: ${context.packageJson.name}`);
    sections.push(`- Version: ${context.packageJson.version}`);
  } else {
    sections.push('- No package.json found (not a Node.js project or new directory)');
  }
  sections.push(`- Has React: ${context.hasReactApp ? 'Yes' : 'No'}`);
  sections.push(`- Has Vite: ${context.hasVite ? 'Yes' : 'No'}`);

  // Dependencies
  if (context.packageJson) {
    const deps = context.packageJson.dependencies;
    const devDeps = context.packageJson.devDependencies;

    if (Object.keys(deps).length > 0) {
      sections.push('\n## Dependencies');
      for (const [name, version] of Object.entries(deps)) {
        sections.push(`- ${name}: ${version}`);
      }
    }

    if (Object.keys(devDeps).length > 0) {
      sections.push('\n## Dev Dependencies');
      for (const [name, version] of Object.entries(devDeps)) {
        sections.push(`- ${name}: ${version}`);
      }
    }

    // Scripts
    const scripts = context.packageJson.scripts;
    if (Object.keys(scripts).length > 0) {
      sections.push('\n## Available Scripts');
      for (const [name, command] of Object.entries(scripts)) {
        sections.push(`- ${name}: ${command}`);
      }
    }
  }

  // Vite config summary
  if (context.viteConfig) {
    sections.push('\n## Vite Configuration');
    sections.push('```javascript');
    // Include first 50 lines to keep context manageable
    const lines = context.viteConfig.split('\n').slice(0, 50);
    sections.push(lines.join('\n'));
    if (context.viteConfig.split('\n').length > 50) {
      sections.push('// ... (truncated)');
    }
    sections.push('```');
  }

  // File tree
  sections.push('\n## File Structure');
  sections.push('```');
  sections.push(formatFileTree(context.fileTree));
  sections.push('```');

  return sections.join('\n');
}

/**
 * Formats the file tree as a text representation
 */
function formatFileTree(nodes: FileTreeNode[], indent: string = ''): string {
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;
    const prefix = isLast ? '└── ' : '├── ';
    const childIndent = isLast ? '    ' : '│   ';

    lines.push(`${indent}${prefix}${node.name}${node.type === 'directory' ? '/' : ''}`);

    if (node.children && node.children.length > 0) {
      lines.push(formatFileTree(node.children, indent + childIndent));
    }
  }

  return lines.join('\n');
}

/**
 * Creates a shorter summary for ongoing context (after initial scan)
 */
export function createCompactSummary(context: RepoContext): string {
  const parts: string[] = [];

  if (context.packageJson) {
    parts.push(`Project: ${context.packageJson.name}`);
  }

  const features: string[] = [];
  if (context.hasReactApp) features.push('React');
  if (context.hasVite) features.push('Vite');

  if (features.length > 0) {
    parts.push(`Stack: ${features.join(' + ')}`);
  }

  return parts.join(' | ');
}
