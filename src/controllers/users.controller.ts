import { Request, Response, NextFunction } from 'express';
import { queryOne } from '../helpers/db.helper';
import { User } from '../types/entities';
import { AppError } from '../middlewares/error.middleware';

/**
 * GET /api/users/me
 * Returns the authenticated user's profile (without password_hash).
 * Requires: authMiddleware (req.user must be populated).
 */
export async function getMe(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // req.user is guaranteed to exist here because authMiddleware runs first
    const { userId } = req.user!;

    const user = await queryOne<Omit<User, 'password_hash'>>(
      `SELECT
         id,
         company_id,
         first_name,
         middle_name,
         last_name,
         second_last_name,
         email,
         role,
         phone_number,
         created_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    // This should never happen if the JWT is valid, but we guard against it
    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.status(200).json({
      status: 'success',
      user,
    });
  } catch (error) {
    next(error);
  }
}
