import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ZodError } from 'zod';
import { ValidationResult } from '../types';
import { logger } from '../utils/logger';
import { AppError } from '../utils/appError';

const generatedTestSchema = z.object({
  content: z.string().min(1, 'Generated test content is required.'),
  model: z.string().optional(),
  prompt: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

const envelopeSchema = z.union([
  generatedTestSchema,
  z.object({
    generatedTest: generatedTestSchema,
    component: z
      .object({
        name: z.string().min(1),
        complexity: z.number().optional()
      })
      .optional()
  })
]);

const evaluateTest = (content: string): { valid: boolean; issues: string[] } => {
  const issues: string[] = [];
  const normalized = content.trim();

  if (!normalized.length) {
    issues.push('Generated test content is empty.');
  }

  if (!normalized.includes('describe(') && !normalized.includes('test(') && !normalized.includes('it(')) {
    issues.push('Test should include at least one describe/test/it block.');
  }

  if (!normalized.includes('@testing-library/react')) {
    issues.push('Test should import from @testing-library/react.');
  }

  return {
    valid: issues.length === 0,
    issues
  };
};

export const validateGeneratedTest = (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = envelopeSchema.parse(req.body);
    const generatedTest =
      'generatedTest' in parsed ? parsed.generatedTest : parsed;
    const component = 'generatedTest' in parsed ? parsed.component : undefined;

    const result = evaluateTest(generatedTest.content);

    const response: ValidationResult = {
      valid: result.valid,
      issues: result.issues,
      generatedTest
    };

    if (result.valid) {
      logger.info('Generated test passed validation.', {
        component: component?.name,
        issues: result.issues.length
      });
    } else {
      logger.warn('Generated test reported validation issues.', {
        component: component?.name,
        issues: result.issues
      });
    }

    res.json({
      success: true,
      data: response
    });
  } catch (error) {
    if (error instanceof ZodError) {
      next(new AppError(400, 'Invalid validation payload.', error.flatten()));
      return;
    }
    next(error);
  }
};
