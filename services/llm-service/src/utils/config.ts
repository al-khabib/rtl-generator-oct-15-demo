import dotenv from 'dotenv';
import { EnvironmentConfig } from '../types';

dotenv.config();

const DEFAULT_PORT = 3002;
const DEFAULT_SERVICE_NAME = 'llm-service';
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

const parsePort = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const config: EnvironmentConfig = {
  port: parsePort(process.env.PORT, DEFAULT_PORT),
  serviceName: process.env.SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_URL
};
