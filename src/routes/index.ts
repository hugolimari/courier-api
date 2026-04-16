import { Router } from 'express';
import authRoutes from './auth.routes';
import usersRoutes from './users.routes';

const router = Router();

// Auth routes — public (no JWT required)
router.use('/auth', authRoutes);

// Users routes — protected (authMiddleware applied inside users.routes.ts)
router.use('/users', usersRoutes);

// Future routes will be added here, e.g.:
// router.use('/packages', packagesRoutes);

export default router;
