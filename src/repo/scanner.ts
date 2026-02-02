/**
 * Repository Scanner
 *
 * Scans the current directory to build context about the project.
 * Ignores common non-essential directories like node_modules, .git, dist.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { RepoContext, FileTreeNode, PackageJsonSummary } from '../types.js';

// Directories to ignore when scanning
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '.turbo',
  '.vercel',
  '.output',
]);

// Maximum depth for file tree scanning
const MAX_DEPTH = 4;

/**
 * Scans the repository and builds context for the LLM
 */
export async function scanRepository(rootPath: string): Promise<RepoContext> {
  const context: RepoContext = {
    rootPath,
    packageJson: null,
    viteConfig: null,
    fileTree: [],
    hasReactApp: false,
    hasVite: false,
  };

  // Read package.json if it exists
  context.packageJson = await readPackageJson(rootPath);

  // Check for Vite config
  context.viteConfig = await findViteConfig(rootPath);
  context.hasVite = context.viteConfig !== null;

  // Check for React
  if (context.packageJson) {
    const allDeps = {
      ...context.packageJson.dependencies,
      ...context.packageJson.devDependencies,
    };
    context.hasReactApp = 'react' in allDeps;
  }

  // Build file tree (limited depth)
  context.fileTree = await buildFileTree(rootPath, 0);

  return context;
}

/**
 * Reads and parses package.json
 */
async function readPackageJson(rootPath: string): Promise<PackageJsonSummary | null> {
  const packagePath = path.join(rootPath, 'package.json');

  try {
    const content = await fs.readFile(packagePath, 'utf-8');
    const pkg = JSON.parse(content);

    return {
      name: pkg.name ?? 'unnamed',
      version: pkg.version ?? '0.0.0',
      dependencies: pkg.dependencies ?? {},
      devDependencies: pkg.devDependencies ?? {},
      scripts: pkg.scripts ?? {},
    };
  } catch {
    return null;
  }
}

/**
 * Finds Vite configuration file
 */
async function findViteConfig(rootPath: string): Promise<string | null> {
  const configNames = [
    'vite.config.ts',
    'vite.config.js',
    'vite.config.mts',
    'vite.config.mjs',
  ];

  for (const name of configNames) {
    const configPath = path.join(rootPath, name);
    try {
      await fs.access(configPath);
      const content = await fs.readFile(configPath, 'utf-8');
      return content;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Recursively builds a file tree structure
 */
async function buildFileTree(
  dirPath: string,
  depth: number,
  relativePath: string = ''
): Promise<FileTreeNode[]> {
  if (depth > MAX_DEPTH) {
    return [];
  }

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nodes: FileTreeNode[] = [];

    // Sort entries: directories first, then files
    const sortedEntries = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sortedEntries) {
      // Skip hidden files and ignored directories
      if (entry.name.startsWith('.') && entry.name !== '.env.example') {
        continue;
      }

      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      const entryRelativePath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;

      const node: FileTreeNode = {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        path: entryRelativePath,
      };

      if (entry.isDirectory()) {
        const fullPath = path.join(dirPath, entry.name);
        node.children = await buildFileTree(fullPath, depth + 1, entryRelativePath);
      }

      nodes.push(node);
    }

    return nodes;
  } catch {
    return [];
  }
}

/**
 * Gets the content of a file
 */
export async function readFileContent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Checks if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
