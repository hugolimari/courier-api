import { Router } from 'express';
import authRoutes from './auth.routes';
import usersRoutes from './users.routes';
import packagesRoutes from './packages.routes';
import trackingRoutes from './tracking.routes';

const router = Router();

// Auth routes — public (no JWT required)
router.use('/auth', authRoutes);

// Users routes — protected (authMiddleware applied inside users.routes.ts)
router.use('/users', usersRoutes);

// Packages routes — mixed: /track/:id is public, rest are protected
router.use('/packages', packagesRoutes);

// Tracking routes — COURIER only
router.use('/tracking', trackingRoutes);

export default router;
