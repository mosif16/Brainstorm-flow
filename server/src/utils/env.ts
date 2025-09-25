import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const requiredEnv = ['GEMINI_API_KEY'] as const;

type RequiredKey = typeof requiredEnv[number];

export interface AppConfig {
  geminiApiKey: string;
  port: number;
  defaultN: number;
  defaultK: number;
  runsDir: string;
}

function getRequiredEnv(key: RequiredKey): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getNumberEnv(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${key} must be a positive number.`);
  }
  return parsed;
}

export function loadConfig(): AppConfig {
  const geminiApiKey = getRequiredEnv('GEMINI_API_KEY');
  const port = getNumberEnv('PORT', 4000);
  const defaultN = getNumberEnv('DEFAULT_N', 6);
  const defaultK = getNumberEnv('DEFAULT_K', 3);
  const runsDir = process.env.RUNS_DIR || path.resolve(process.cwd(), '../runs');

  return { geminiApiKey, port, defaultN, defaultK, runsDir };
}
