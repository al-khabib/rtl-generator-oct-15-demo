import dotenv from 'dotenv';
import { EnvironmentConfig } from '../types';

dotenv.config();

const DEFAULT_PORT = 3000;
const DEFAULT_SERVICE_NAME = 'api-gateway';

const parsePort = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const config: EnvironmentConfig = {
  port: parsePort(process.env.PORT, DEFAULT_PORT),
  serviceName: process.env.SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME
};
