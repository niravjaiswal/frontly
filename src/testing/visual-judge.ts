/**
 * Visual Judge — Diagnostic-Only Screenshot Analysis
 *
 * This module provides an LLM-based visual analysis of test run screenshots.
 * It is DIAGNOSTIC ONLY and must NEVER:
 *   - Change test pass/fail outcomes
 *   - Gate CI pipelines
 *   - Replace deterministic assertions
 *   - Modify files directly
 *
 * The visual judge is best-effort and allowed to be wrong. Its findings
 * are advisory hints that feed into the failure summary for the auto-fix
 * loop. If anything fails (LLM error, parse error, missing artifacts),
 * execution continues normally.
 */

import pkg from 'fs-extra';
const { readdir, readFile, pathExists } = pkg;
import { join } from 'node:path';
import chalk from 'chalk';
import { getClient } from '../gemini/client.js';
import { loadFeatureIntent } from '../intent/feature-intent.js';
import type { TestPlan, TestStep } from './types.js';

// ── Types ──────────────────────────────────────────────────────────

export type VisualIssue = {
  checkpoint: string;
  type: 'missing-element' | 'layout-break' | 'overlap' | 'blank-screen' | 'unexpected-page' | 'other';
  description: string;
  confidence: number; // 0–1
};

export type VisualJudgeResult = {
  issues: VisualIssue[];
};

const VALID_ISSUE_TYPES = new Set([
  'missing-element',
  'layout-break',
  'overlap',
  'blank-screen',
  'unexpected-page',
  'other',
]);

const DOM_TRUNCATE_LIMIT = 15_000;

// ── Main export ────────────────────────────────────────────────────

export async function runVisualJudge(options: {
  cwd: string;
  runDir: string;
  testPlan: TestPlan;
}): Promise<VisualJudgeResult | null> {
  try {
    const { cwd, runDir, testPlan } = options;

    // 1. Load screenshots
    const screenshotDir = join(runDir, 'screenshots');
    if (!(await pathExists(screenshotDir))) {
      return null;
    }

    const screenshotFiles = (await readdir(screenshotDir))
      .filter((f: string) => f.endsWith('.png'))
      .sort();

    if (screenshotFiles.length === 0) {
      return null;
    }

    // Read screenshots as base64
    const screenshots: { name: string; base64: string }[] = [];
    for (const file of screenshotFiles) {
      const buf = await readFile(join(screenshotDir, file));
      screenshots.push({
        name: file.replace(/\.png$/, ''),
        base64: buf.toString('base64'),
      });
    }

    // 2. Load DOM snapshots
    const domDir = join(runDir, 'dom');
    const domSnapshots: { name: string; html: string }[] = [];
    if (await pathExists(domDir)) {
      const domFiles = (await readdir(domDir))
        .filter((f: string) => f.endsWith('.html'))
        .sort();

      for (const file of domFiles) {
        let html = await readFile(join(domDir, file), 'utf-8');
        if (html.length > DOM_TRUNCATE_LIMIT) {
          html = html.slice(0, DOM_TRUNCATE_LIMIT) + '\n<!-- truncated -->';
        }
        domSnapshots.push({
          name: file.replace(/\.html$/, ''),
          html,
        });
      }
    }

    // 3. Load feature intent
    const featureIntent = await loadFeatureIntent(cwd);

    // 4. Build prompt
    const promptText = buildPrompt(testPlan, featureIntent?.intent ?? null, domSnapshots);

    // 5. Build multimodal content parts
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    parts.push({ text: promptText });

    // Interleave screenshots
    for (const screenshot of screenshots) {
      parts.push({ text: `\n### Screenshot: ${screenshot.name}\n` });
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: screenshot.base64,
        },
      });
    }

    // 6. Call Gemini
    const client = getClient();
    const model = client.getGenerativeModel({
      model: 'gemini-1.5-pro',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });

    const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
    const responseText = result.response.text();

    // 7. Parse and validate response
    const parsed = JSON.parse(responseText) as { issues?: unknown[] };

    if (!parsed.issues || !Array.isArray(parsed.issues)) {
      return { issues: [] };
    }

    const issues: VisualIssue[] = parsed.issues
      .filter((item: unknown): item is Record<string, unknown> => {
        if (!item || typeof item !== 'object') return false;
        const obj = item as Record<string, unknown>;
        return (
          typeof obj.checkpoint === 'string' &&
          typeof obj.type === 'string' &&
          typeof obj.description === 'string' &&
          typeof obj.confidence === 'number'
        );
      })
      .filter((item) => VALID_ISSUE_TYPES.has(item.type as string))
      .map((item) => ({
        checkpoint: item.checkpoint as string,
        type: item.type as VisualIssue['type'],
        description: item.description as string,
        confidence: Math.max(0, Math.min(1, item.confidence as number)),
      }));

    return { issues };
  } catch (error) {
    console.log(chalk.dim(`  Visual judge skipped: ${(error as Error).message}`));
    return null;
  }
}

// ── Prompt construction ────────────────────────────────────────────

function buildPrompt(
  testPlan: TestPlan,
  intent: string | null,
  domSnapshots: { name: string; html: string }[],
): string {
  const lines: string[] = [];

  lines.push('You are a visual QA judge reviewing screenshots of a web application.');
  lines.push('');

  // Feature intent
  lines.push('## Feature Intent');
  lines.push(intent ?? 'No feature intent provided.');
  lines.push('');

  // Test plan
  lines.push('## Test Plan');
  lines.push(`Intent: ${testPlan.intent}`);
  lines.push('Steps:');
  for (let i = 0; i < testPlan.steps.length; i++) {
    lines.push(`  ${i}. ${formatStep(testPlan.steps[i])}`);
  }
  lines.push('');

  // Evaluation criteria
  lines.push('## Evaluation Criteria');
  lines.push('Examine each screenshot for:');
  lines.push('1. missing-element — Required UI elements not present');
  lines.push('2. layout-break — Layout collapsed, broken grid/flex, elements mispositioned');
  lines.push('3. overlap — Elements overlapping unintentionally');
  lines.push('4. blank-screen — Page is blank or shows only a white/empty screen');
  lines.push('5. unexpected-page — Page content does not match the expected route/context');
  lines.push('6. other — Any other obvious visual defect');
  lines.push('');

  // DOM snapshots
  if (domSnapshots.length > 0) {
    lines.push('## DOM Snapshots');
    for (const snap of domSnapshots) {
      lines.push(`### Checkpoint: ${snap.name}`);
      lines.push('```html');
      lines.push(snap.html);
      lines.push('```');
      lines.push('');
    }
  }

  // Instructions
  lines.push('## Instructions');
  lines.push('- Do NOT judge aesthetics or styling polish');
  lines.push('- Only report obvious, user-visible problems');
  lines.push('- For each issue, reference the checkpoint name from the screenshot');
  lines.push('- Set confidence between 0 and 1 (1 = certain, 0.5 = likely, below 0.3 = uncertain)');
  lines.push('- If there are no issues, return { "issues": [] }');
  lines.push('- Return ONLY valid JSON: { "issues": [{ "checkpoint": "...", "type": "...", "description": "...", "confidence": 0.0 }] }');

  return lines.join('\n');
}

function formatStep(step: TestStep): string {
  switch (step.type) {
    case 'navigate':
      return `navigate to ${step.url}`;
    case 'assertRoute':
      return `assertRoute "${step.path}"`;
    case 'click':
      return `click "${step.selector}" — ${step.description}`;
    case 'fill':
      return `fill "${step.selector}" with "${step.value}" — ${step.description}`;
  }
}
