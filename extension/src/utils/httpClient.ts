import axios, { AxiosError, AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import { ApiResponse, ComponentInfo, GeneratedTest } from '../types';

const DEFAULT_TIMEOUT = 10000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createAxiosClient = (): AxiosInstance => {
  const configuration = vscode.workspace.getConfiguration('rtlTestGenerator');
  const baseURL =
    configuration.get<string>('apiGatewayUrl') ?? 'http://localhost:3000';

  return axios.create({
    baseURL,
    timeout: DEFAULT_TIMEOUT
  });
};

const withRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) {
        break;
      }

      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError;
};

const extractErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ message?: string }>;
    return (
      axiosError.response?.data?.message ??
      axiosError.message ??
      'Request failed'
    );
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unknown error occurred';
};

const clientRequest = async <T>(
  request: () => Promise<ApiResponse<T>>
): Promise<T> => {
  const response = await withRetry(request);

  if (!response.success || response.data === undefined) {
    throw new Error(response.message ?? 'Unexpected response from API');
  }

  return response.data;
};

const generateTest = async (componentInfo: ComponentInfo): Promise<GeneratedTest> => {
  const client = createAxiosClient();

  return clientRequest(async () => {
    const { data } = await client.post<ApiResponse<GeneratedTest>>(
      '/api/generate-test',
      componentInfo
    );
    return data;
  });
};

const checkHealth = async (): Promise<boolean> => {
  const client = createAxiosClient();

  try {
    await withRetry(async () => {
      await client.get('/health');
    });
    return true;
  } catch (error) {
    const message = extractErrorMessage(error);
    throw new Error(`API health check failed: ${message}`);
  }
};

export const httpClient = {
  generateTest,
  checkHealth,
  extractErrorMessage
};
