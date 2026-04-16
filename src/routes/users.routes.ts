import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { getMe } from '../controllers/users.controller';

const router = Router();

// All routes in this file require a valid JWT
router.use(authMiddleware);

// GET /api/users/me — returns the authenticated user's profile
router.get('/me', getMe);

export default router;
