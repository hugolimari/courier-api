import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireRoles } from '../middlewares/role.middleware';
import {
  createPackage,
  trackPackage,
  listPackages,
} from '../controllers/packages.controller';

const router = Router();

// ── PUBLIC routes (no JWT required) ──────────────────────────────────────────

// Must be declared BEFORE the authMiddleware block below
// so it doesn't accidentally get protected.
router.get('/track/:tracking_number', trackPackage);

// ── PROTECTED routes (JWT required for all routes below) ─────────────────────

router.use(authMiddleware);

// GET  /api/packages  — ADMIN: their company | COURIER: assigned | CUSTOMER: theirs
router.get('/', listPackages);

// POST /api/packages  — ADMIN only
router.post('/', requireRoles('ADMIN'), createPackage);

// Future routes:
// PATCH /api/packages/:id/status — ADMIN, COURIER
// GET   /api/packages/:id        — ADMIN, COURIER, CUSTOMER

export default router;
