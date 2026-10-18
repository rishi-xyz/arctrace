import type { ZodType } from 'zod';
import { badRequest } from './errors.js';

/** Parse a request payload, throwing a 400 VALIDATION_FAILED ApiError on failure. */
export function validate<T>(schema: ZodType<T>, data: unknown, what = 'request body'): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw badRequest(`Invalid ${what}: ${detail}`);
  }
  return result.data;
}
