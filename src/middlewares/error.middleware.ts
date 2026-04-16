import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodIssue } from 'zod';

// ─────────────────────────────────────────────
// Custom Application Error
// ─────────────────────────────────────────────

export class AppError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
    // Maintains proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

// ─────────────────────────────────────────────
// Global Error Handler Middleware
// ─────────────────────────────────────────────

export function errorMiddleware(
  err: Error,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // Zod validation errors → 400 Bad Request with field-level details
  if (err instanceof ZodError) {
    res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors: err.issues.map((issue: ZodIssue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  // Known application errors (e.g., 404 Not Found, 409 Conflict, 401 Unauthorized)
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
    });
    return;
  }

  // Unexpected errors → 500, never expose internal details in production
  console.error('Unhandled error:', err);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
  });
}
