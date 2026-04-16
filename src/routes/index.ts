import { Router } from 'express';
import authRoutes from './auth.routes';

const router = Router();

// Auth routes — public (no JWT required)
router.use('/auth', authRoutes);

// Future routes will be added here, e.g.:
// router.use('/packages', authMiddleware, packageRoutes);
// router.use('/users', authMiddleware, userRoutes);

export default router;
