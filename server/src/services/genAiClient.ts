import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AppConfig } from '../utils/env';

let cachedClient: GoogleGenerativeAI | null = null;
let cachedKey: string | null = null;

export function getGenAiClient(config: AppConfig): GoogleGenerativeAI {
  if (!cachedClient || cachedKey !== config.geminiApiKey) {
    cachedClient = new GoogleGenerativeAI(config.geminiApiKey);
    cachedKey = config.geminiApiKey;
  }
  return cachedClient;
}
