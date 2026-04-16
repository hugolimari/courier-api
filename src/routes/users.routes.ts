import { Router } from 'express';
import { getMe, getUsers } from '../controllers/users.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRoles } from '../middlewares/role.middleware';

const router = Router();

// All routes in this file require a valid JWT
router.use(authMiddleware);

// GET /api/users/me — returns the authenticated user's profile
router.get('/me', getMe);

// GET /api/users — returns list of users filtered by company (ADMIN only)
// Optional: ?role=COURIER | CUSTOMER | ADMIN
router.get('/', requireRoles('ADMIN'), getUsers);

export default router;
