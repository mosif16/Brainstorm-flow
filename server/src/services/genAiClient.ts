import { GoogleGenAI } from '@google/genai';
import type { AppConfig } from '../utils/env';

let cachedClient: GoogleGenAI | null = null;
let cachedKey: string | null = null;

export function getGenAiClient(config: AppConfig): GoogleGenAI {
  if (!cachedClient || cachedKey !== config.geminiApiKey) {
    cachedClient = new GoogleGenAI({ apiKey: config.geminiApiKey });
    cachedKey = config.geminiApiKey;
  }
  return cachedClient;
}
