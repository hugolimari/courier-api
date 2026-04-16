import { UserRole } from './entities';

// Extends Express's Request interface to include the authenticated user payload
// populated by auth.middleware.ts after JWT verification.
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export interface JwtPayload {
  userId: string;
  companyId: string;
  role: UserRole;
}
