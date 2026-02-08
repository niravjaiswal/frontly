export interface ArtifactRun {
  path: string;
  timestamp: string;
}

export interface ArtifactMeta {
  timestamp: string;
  command: string;
  browser: string;
  status: 'completed' | 'failed';
  intent?: string;
}
