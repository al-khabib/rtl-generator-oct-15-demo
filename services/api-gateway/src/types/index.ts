export type ServiceName = 'code-analysis' | 'llm-service' | 'test-validation';

export interface EnvironmentConfig {
  port: number;
  serviceName: string;
  codeAnalysisUrl: string;
  llmServiceUrl: string;
  testValidationUrl: string;
  requestTimeoutMs: number;
  retryAttempts: number;
  circuitBreaker: {
    failureThreshold: number;
    cooldownMs: number;
  };
  rateLimit: {
    windowMs: number;
    max: number;
  };
  allowedOrigins: string[];
}

export interface ComponentInfo {
  name: string;
  filePath: string;
  props?: string | null;
  imports: string[];
  hasTests: boolean;
}

export interface ComponentAnalysisResult {
  component: ComponentInfo;
  metadata: Record<string, unknown>;
}

export interface GeneratedTest {
  fileName: string;
  content: string;
  relativePath?: string;
  summary?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues?: string[];
  generatedTest: GeneratedTest;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  correlationId: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    message: string;
    code: string;
    correlationId?: string;
    details?: unknown;
  };
}

export interface ServiceHealth {
  service: ServiceName;
  healthy: boolean;
  message?: string;
  latencyMs?: number;
}

export type StatusReport = {
  gateway: {
    service: string;
    healthy: boolean;
    timestamp: string;
  };
  dependencies: ServiceHealth[];
};

export class ServiceError extends Error {
  public readonly statusCode: number;

  public readonly code: string;

  public readonly correlationId?: string;

  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode = 500,
    code = 'internal_error',
    correlationId?: string,
    details?: unknown
  ) {
    super(message);
    this.name = 'ServiceError';
    this.statusCode = statusCode;
    this.code = code;
    this.correlationId = correlationId;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static validation(message: string, details?: unknown, correlationId?: string): ServiceError {
    return new ServiceError(message, 400, 'validation_error', correlationId, details);
  }

  static timeout(service: ServiceName | string, correlationId?: string): ServiceError {
    return new ServiceError(
      `${service} did not respond in time.`,
      504,
      'service_timeout',
      correlationId
    );
  }

  static unavailable(service: ServiceName | string, correlationId?: string, details?: unknown): ServiceError {
    return new ServiceError(
      `${service} is currently unavailable.`,
      503,
      'service_unavailable',
      correlationId,
      details
    );
  }
}

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Request {
      correlationId?: string;
    }

    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Response {
      locals: Record<string, unknown> & {
        correlationId?: string;
        requestStartTime?: number;
      };
    }
  }
}

export {};
