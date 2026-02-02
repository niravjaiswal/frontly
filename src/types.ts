/**
 * Core types for the Frontly CLI tool
 */

// Chat message types
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

// File operation types for the planning model
export interface FileToCreate {
  path: string;
  description: string;
}

export interface FileToModify {
  path: string;
  description: string;
}

// The plan that Gemini outputs before any file operations
export interface ExecutionPlan {
  reasoning: string;
  files_to_create: FileToCreate[];
  files_to_modify: FileToModify[];
  files_to_delete: string[];
}

// File content after plan approval
export interface FileContent {
  path: string;
  content: string;
}

// Diff tracking for /diff command
export interface FileDiff {
  path: string;
  before: string | null;
  after: string;
  operation: 'create' | 'modify' | 'delete';
}

export interface DiffHistory {
  timestamp: Date;
  diffs: FileDiff[];
}

// Repo context types
export interface RepoContext {
  rootPath: string;
  packageJson: PackageJsonSummary | null;
  viteConfig: string | null;
  fileTree: FileTreeNode[];
  hasReactApp: boolean;
  hasVite: boolean;
}

export interface PackageJsonSummary {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
}

export interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileTreeNode[];
}

// Gemini API types
export interface GeminiConfig {
  apiKey: string;
  model: string;
}

export interface GeminiResponse {
  text: string;
  plan?: ExecutionPlan;
  fileContents?: FileContent[];
}

// Application state
export interface AppState {
  messages: ChatMessage[];
  repoContext: RepoContext | null;
  lastDiff: DiffHistory | null;
  isLoading: boolean;
  pendingPlan: ExecutionPlan | null;
}
