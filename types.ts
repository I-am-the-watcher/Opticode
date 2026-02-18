export enum OptimizationLevel {
  LEVEL_1 = 'level1', // Rule-Based (Deterministic)
  LEVEL_2 = 'level2'  // LLM-Based (AI)
}

export interface CodeMetrics {
  cyclomaticComplexity: number;
  linesOfCode: number;
  maintainabilityIndex: number;
  estimatedSpeedup: string;
}

export interface OptimizationResult {
  originalCode: string;
  optimizedCode: string;
  explanation: string;
  metrics: CodeMetrics;
  changes: Array<{
    line: number;
    description: string;
    type: 'improvement' | 'removal' | 'replacement';
  }>;
  level: OptimizationLevel;
  timestamp: number;
  id?: string;
  name?: string; // Users can now give their projects custom names
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}