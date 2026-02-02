/**
 * File Writer Module
 *
 * Handles safe file writing operations with diff tracking.
 * Ensures files are never overwritten blindly.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createFileDiff } from './diff.js';
import { requestFileContent } from '../gemini/client.js';
import { validateCode, formatValidationErrors } from './validator.js';
import type { ExecutionPlan, DiffHistory, FileDiff, ChatMessage, ApplyPlanResult, ValidationResult } from '../types.js';

/**
 * Applies an execution plan by creating, modifying, and deleting files
 * Validates code before writing and returns validation results
 */
export async function applyPlan(
  plan: ExecutionPlan,
  rootPath: string,
  getFileContent: (filePath: string) => Promise<string>,
  options: { skipValidation?: boolean } = {}
): Promise<ApplyPlanResult> {
  const diffs: FileDiff[] = [];
  const validationResults: ValidationResult[] = [];
  const pendingWrites: { fullPath: string; content: string; diff: FileDiff }[] = [];

  // Collect all file contents and validate before writing
  // Create new files
  for (const file of plan.files_to_create) {
    const fullPath = path.join(rootPath, file.path);
    const content = await getFileContent(file.path);

    // Validate the content
    if (!options.skipValidation) {
      const validation = validateCode(file.path, content);
      validationResults.push(validation);
    }

    pendingWrites.push({
      fullPath,
      content,
      diff: createFileDiff(file.path, 'create', null, content),
    });
  }

  // Modify existing files
  for (const file of plan.files_to_modify) {
    const fullPath = path.join(rootPath, file.path);

    // Read existing content
    let existingContent: string | null = null;
    try {
      existingContent = await fs.readFile(fullPath, 'utf-8');
    } catch {
      // File doesn't exist, treat as create
    }

    // Get new content
    const newContent = await getFileContent(file.path);

    // Validate the content
    if (!options.skipValidation) {
      const validation = validateCode(file.path, newContent);
      validationResults.push(validation);
    }

    // Only write if content is different
    if (newContent !== existingContent) {
      const operation = existingContent === null ? 'create' : 'modify';
      pendingWrites.push({
        fullPath,
        content: newContent,
        diff: createFileDiff(file.path, operation, existingContent, newContent),
      });
    }
  }

  // Check if there are validation errors
  const hasValidationErrors = validationResults.some(
    (r) => !r.isValid
  );

  // If validation failed and we're not skipping, return early with results
  if (hasValidationErrors && !options.skipValidation) {
    return {
      diffHistory: { timestamp: new Date(), diffs: [] },
      validationResults,
      hasValidationErrors: true,
    };
  }

  // All validations passed (or skipped), write the files
  for (const write of pendingWrites) {
    await fs.mkdir(path.dirname(write.fullPath), { recursive: true });
    await fs.writeFile(write.fullPath, write.content, 'utf-8');
    diffs.push(write.diff);
  }

  // Delete files (no validation needed)
  for (const filePath of plan.files_to_delete) {
    const fullPath = path.join(rootPath, filePath);

    try {
      const existingContent = await fs.readFile(fullPath, 'utf-8');
      await fs.unlink(fullPath);
      diffs.push(createFileDiff(filePath, 'delete', existingContent, ''));
    } catch {
      // File doesn't exist, skip
      continue;
    }
  }

  return {
    diffHistory: { timestamp: new Date(), diffs },
    validationResults,
    hasValidationErrors: false,
  };
}

/**
 * Previews changes that would be made by a plan without applying them
 */
export async function previewPlan(
  plan: ExecutionPlan,
  rootPath: string
): Promise<{ exists: boolean; path: string }[]> {
  const results: { exists: boolean; path: string }[] = [];

  // Check files to create
  for (const file of plan.files_to_create) {
    const fullPath = path.join(rootPath, file.path);
    const exists = await fileExists(fullPath);
    results.push({ path: file.path, exists });
  }

  // Check files to modify
  for (const file of plan.files_to_modify) {
    const fullPath = path.join(rootPath, file.path);
    const exists = await fileExists(fullPath);
    results.push({ path: file.path, exists });
  }

  // Check files to delete
  for (const filePath of plan.files_to_delete) {
    const fullPath = path.join(rootPath, filePath);
    const exists = await fileExists(fullPath);
    results.push({ path: filePath, exists });
  }

  return results;
}

/**
 * Checks if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a file's content if it exists
 */
export async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Safely creates a directory and all parent directories
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Backs up a file before modification (optional safety feature)
 */
export async function backupFile(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const backupPath = `${filePath}.backup.${Date.now()}`;
    await fs.writeFile(backupPath, content, 'utf-8');
    return backupPath;
  } catch {
    return null;
  }
}

/**
 * Restores a file from backup
 */
export async function restoreFromBackup(
  backupPath: string,
  originalPath: string
): Promise<boolean> {
  try {
    const content = await fs.readFile(backupPath, 'utf-8');
    await fs.writeFile(originalPath, content, 'utf-8');
    await fs.unlink(backupPath);
    return true;
  } catch {
    return false;
  }
}
