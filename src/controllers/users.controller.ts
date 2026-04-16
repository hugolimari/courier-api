import { Request, Response, NextFunction } from 'express';
import { query, queryOne } from '../helpers/db.helper';
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

/**
 * GET /api/users
 * Returns list of users for the same company.
 * Optional query param: ?role=COURIER | CUSTOMER | ADMIN
 * Requires: authMiddleware + ADMIN role.
 */
export async function getUsers(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { companyId } = req.user!;
    const { role } = req.query;

    const params: unknown[] = [companyId];
    let queryStr = `
      SELECT
        id,
        first_name,
        last_name,
        email,
        role,
        phone_number
      FROM users
      WHERE company_id = $1
    `;

    if (role && typeof role === 'string') {
      params.push(role);
      queryStr += ` AND role = $2`;
    }

    queryStr += ` ORDER BY first_name ASC`;

    const records = await query<Pick<User, 'id' | 'first_name' | 'last_name' | 'email' | 'role' | 'phone_number'>>(queryStr, params);

    res.status(200).json({
      status: 'success',
      count: records.length,
      users: records,
    });
  } catch (error) {
    next(error);
  }
}
