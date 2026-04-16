import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import * as z from 'zod';
import { queryOne } from '../helpers/db.helper';
import { User } from '../types/entities';
import { AppError } from '../middlewares/error.middleware';
import { env } from '../config/env';
import { JwtPayload } from '../types/express.d';

// ─────────────────────────────────────────────
// Zod Schemas
// ─────────────────────────────────────────────

const registerSchema = z.object({
  company_id: z.string().uuid({ message: 'company_id must be a valid UUID' }),
  first_name: z.string().min(1, 'first_name is required'),
  middle_name: z.string().optional(),
  last_name: z.string().min(1, 'last_name is required'),
  second_last_name: z.string().optional(),
  email: z.string().email({ message: 'Must be a valid email address' }),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['ADMIN', 'COURIER', 'CUSTOMER']),
  phone_number: z.string().min(7, 'phone_number is required'),
});

const loginSchema = z.object({
  email: z.string().email({ message: 'Must be a valid email address' }),
  password: z.string().min(1, 'Password is required'),
});

// Infer types from schemas for type-safe access
type RegisterInput = z.infer<typeof registerSchema>;
type LoginInput = z.infer<typeof loginSchema>;

// ─────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────

function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

// ─────────────────────────────────────────────
// Controllers
// ─────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Registers a new user, hashes their password, and returns a signed JWT.
 */
export async function register(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Validate request body — throws ZodError on failure (caught by errorMiddleware)
    const body: RegisterInput = registerSchema.parse(req.body);

    // 2. Check if email is already taken
    const existingUser = await queryOne<User>(
      'SELECT id FROM users WHERE email = $1',
      [body.email]
    );
    if (existingUser) {
      throw new AppError('Email is already registered', 409);
    }

    // 3. Hash the password (salt rounds = 10, good balance of security and speed)
    const password_hash = await bcrypt.hash(body.password, 10);

    // 4. Insert the new user into the database
    const newUser = await queryOne<User>(
      `INSERT INTO users
        (company_id, first_name, middle_name, last_name, second_last_name, email, password_hash, role, phone_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, company_id, first_name, middle_name, last_name, second_last_name, email, role, phone_number, created_at`,
      [
        body.company_id,
        body.first_name,
        body.middle_name ?? null,
        body.last_name,
        body.second_last_name ?? null,
        body.email,
        password_hash,
        body.role,
        body.phone_number,
      ]
    );

    if (!newUser) {
      throw new AppError('Failed to create user', 500);
    }

    // 5. Sign and return the JWT (never include password_hash in the token or response)
    const token = signToken({
      userId: newUser.id,
      companyId: newUser.company_id,
      role: newUser.role,
    });

    res.status(201).json({
      status: 'success',
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        first_name: newUser.first_name,
        last_name: newUser.last_name,
        role: newUser.role,
        company_id: newUser.company_id,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/auth/login
 * Validates credentials and returns a signed JWT on success.
 */
export async function login(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // 1. Validate request body
    const body: LoginInput = loginSchema.parse(req.body);

    // 2. Look up user by email (include password_hash for comparison)
    const user = await queryOne<User>(
      'SELECT id, company_id, email, password_hash, role, first_name, last_name FROM users WHERE email = $1',
      [body.email]
    );

    // 3. Always compare hashes — even if user doesn't exist — to prevent timing attacks
    const dummyHash = '$2b$10$invalidhashforstoptimingatks00000000000000000000000000000';
    const isMatch = await bcrypt.compare(
      body.password,
      user?.password_hash ?? dummyHash
    );

    if (!user || !isMatch) {
      // Return a generic message — never reveal whether the email exists
      throw new AppError('Invalid email or password', 401);
    }

    // 4. Sign and return the JWT
    const token = signToken({
      userId: user.id,
      companyId: user.company_id,
      role: user.role,
    });

    res.status(200).json({
      status: 'success',
      token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        company_id: user.company_id,
      },
    });
  } catch (error) {
    next(error);
  }
}
