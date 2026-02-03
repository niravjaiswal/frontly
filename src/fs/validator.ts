/**
 * Code Validator Module
 *
 * Validates generated code before writing to disk.
 * Uses TypeScript compiler API for syntax validation.
 */

import ts from 'typescript';
import type { ValidationResult, ValidationError } from '../types.js';

/**
 * File extensions that can be validated
 */
const VALIDATABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts'];

/**
 * Check if a file can be validated based on its extension
 */
export function canValidate(filePath: string): boolean {
  const ext = getExtension(filePath);
  return VALIDATABLE_EXTENSIONS.includes(ext);
}

/**
 * Get the file extension from a path
 */
function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.slice(lastDot).toLowerCase();
}

/**
 * Get TypeScript script kind based on file extension
 */
function getScriptKind(filePath: string): ts.ScriptKind {
  const ext = getExtension(filePath);
  switch (ext) {
    case '.ts':
      return ts.ScriptKind.TS;
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.js':
    case '.mjs':
      return ts.ScriptKind.JS;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.mts':
      return ts.ScriptKind.TS;
    default:
      return ts.ScriptKind.Unknown;
  }
}

/**
 * Validates code content for syntax errors
 * Returns validation result with any errors found
 */
export function validateCode(filePath: string, content: string): ValidationResult {
  // Skip validation for non-code files
  if (!canValidate(filePath)) {
    return {
      isValid: true,
      errors: [],
      filePath,
    };
  }

  const errors: ValidationError[] = [];

  // Create a source file for parsing
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath)
  );

  // Collect syntax errors from the parser
  const syntaxErrors = collectSyntaxErrors(sourceFile);
  errors.push(...syntaxErrors);

  // For TypeScript files, also do semantic validation
  const ext = getExtension(filePath);
  if (ext === '.ts' || ext === '.tsx' || ext === '.mts') {
    const semanticErrors = validateTypeScript(filePath, content);
    errors.push(...semanticErrors);
  }

  return {
    isValid: errors.filter((e) => e.severity === 'error').length === 0,
    errors,
    filePath,
  };
}

/**
 * Collect syntax errors from a parsed source file
 */
function collectSyntaxErrors(sourceFile: ts.SourceFile): ValidationError[] {
  const errors: ValidationError[] = [];

  // Walk the AST to find parse errors
  function visit(node: ts.Node) {
    // Check for nodes that indicate parse errors
    if (node.kind === ts.SyntaxKind.Unknown) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      errors.push({
        line: line + 1,
        column: character + 1,
        message: 'Unexpected token',
        severity: 'error',
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // Also check parseDiagnostics if available
  const parseDiagnostics = (sourceFile as any).parseDiagnostics as ts.Diagnostic[] | undefined;
  if (parseDiagnostics) {
    for (const diagnostic of parseDiagnostics) {
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start || 0);
      errors.push({
        line: line + 1,
        column: character + 1,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        severity: 'error',
      });
    }
  }

  return errors;
}

/**
 * Perform TypeScript semantic validation
 * This catches type errors, not just syntax errors
 */
function validateTypeScript(filePath: string, content: string): ValidationError[] {
  const errors: ValidationError[] = [];

  // Create a minimal compiler host
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: false, // Be lenient for generated code
    noEmit: true,
    skipLibCheck: true,
    allowJs: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    isolatedModules: true,
  };

  // Create an in-memory host
  const host = ts.createCompilerHost(compilerOptions);
  const originalGetSourceFile = host.getSourceFile;

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (fileName === filePath || fileName.endsWith(filePath)) {
      return ts.createSourceFile(
        fileName,
        content,
        languageVersion,
        true,
        getScriptKind(filePath)
      );
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };

  host.fileExists = (fileName) => {
    if (fileName === filePath || fileName.endsWith(filePath)) {
      return true;
    }
    return ts.sys.fileExists(fileName);
  };

  host.readFile = (fileName) => {
    if (fileName === filePath || fileName.endsWith(filePath)) {
      return content;
    }
    return ts.sys.readFile(fileName);
  };

  // Create program and get diagnostics
  const program = ts.createProgram([filePath], compilerOptions, host);
  const sourceFile = program.getSourceFile(filePath);

  if (!sourceFile) {
    return errors;
  }

  // Get syntax diagnostics (most important)
  const syntaxDiagnostics = program.getSyntacticDiagnostics(sourceFile);

  for (const diagnostic of syntaxDiagnostics) {
    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      errors.push({
        line: line + 1,
        column: character + 1,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        severity: 'error',
      });
    }
  }

  // Get semantic diagnostics (type errors) - report as warnings since we don't have full context
  const semanticDiagnostics = program.getSemanticDiagnostics(sourceFile);

  for (const diagnostic of semanticDiagnostics) {
    // Skip "Cannot find module" errors since we're validating in isolation
    const messageText = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (messageText.includes('Cannot find module') || messageText.includes('Cannot find name')) {
      continue;
    }

    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      errors.push({
        line: line + 1,
        column: character + 1,
        message: messageText,
        severity: 'warning',
      });
    }
  }

  return errors;
}

/**
 * Validate multiple files at once
 */
export function validateFiles(
  files: { path: string; content: string }[]
): ValidationResult[] {
  return files.map((file) => validateCode(file.path, file.content));
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(results: ValidationResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    if (result.errors.length === 0) continue;

    lines.push(`\n${result.filePath}:`);
    for (const error of result.errors) {
      const prefix = error.severity === 'error' ? '✗' : '⚠';
      lines.push(`  ${prefix} Line ${error.line}:${error.column} - ${error.message}`);
    }
  }

  return lines.join('\n');
}
