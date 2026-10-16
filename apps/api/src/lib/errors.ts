import { ZodError, type ZodTypeAny, type z } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_form';
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

export function validationError(err: ZodError): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', zodFields(err));
}

/** Parse with a Zod schema; throws the API's standard 400 error on failure. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw validationError(r.error);
  return r.data;
}
