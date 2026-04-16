import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRoles } from '../middlewares/role.middleware';
import { updateLocation } from '../controllers/tracking.controller';

const router = Router();

// All tracking routes require JWT
router.use(authMiddleware);

// PATCH /api/tracking — COURIER only updates their own GPS location
router.patch('/', requireRoles('COURIER'), updateLocation);

export default router;
