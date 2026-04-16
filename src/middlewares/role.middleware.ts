import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types/entities';
import { AppError } from './error.middleware';

/**
 * Authorization middleware factory.
 * Checks that the authenticated user has one of the allowed roles.
 * Must be used AFTER authMiddleware (req.user must be populated).
 *
 * @example
 * router.post('/', requireRoles('ADMIN'), createPackage);
 * router.patch('/:id/status', requireRoles('ADMIN', 'COURIER'), updateStatus);
 */
export function requireRoles(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Unauthorized', 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(
          `Forbidden: required role(s) — ${roles.join(', ')}`,
          403
        )
      );
    }

    next();
  };
}
