import { Request, Response, NextFunction } from 'express';
import * as z from 'zod';
import { queryOne } from '../helpers/db.helper';
import { pool } from '../config/db';
import { AppError } from '../middlewares/error.middleware';

// ─────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────

const deliverSchema = z.object({
  receiver_name: z.string().min(2, 'receiver_name must be at least 2 characters').optional(),
  receiver_ci: z.string().min(4, 'receiver_ci must be at least 4 characters').optional(),
  image_url: z.string().url({ message: 'image_url must be a valid URL (e.g. Cloudinary link)' }),
  // Courier's GPS coordinates at the moment of delivery
  longitude: z
    .number({ message: 'longitude must be a number between -180 and 180' })
    .min(-180).max(180),
  latitude: z
    .number({ message: 'latitude must be a number between -90 and 90' })
    .min(-90).max(90),
});

type DeliverInput = z.infer<typeof deliverSchema>;

// ─────────────────────────────────────────────
// Row types
// ─────────────────────────────────────────────

interface PackageLookupRow {
  id: string;
  company_id: string;
  courier_id: string | null;
  status: string;
}

interface DeliveryProofRow {
  id: string;
  package_id: string;
  courier_id: string;
  receiver_name: string | null;
  receiver_ci: string | null;
  image_url: string;
  delivery_point: string; // GeoJSON from ST_AsGeoJSON()
  created_at: Date;
}

// ─────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────

/**
 * POST /api/packages/:id/deliver
 *
 * Marks a package as DELIVERED and creates the delivery proof record.
 * Both operations run inside a SQL transaction for atomicity.
 *
 * Access rules:
 *   COURIER → must be the assigned courier (courier_id)
 *   ADMIN   → can deliver any package within their company
 *   CUSTOMER→ blocked at route level via requireRoles()
 */
export async function deliverPackage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { userId, companyId, role } = req.user!;
    const body: DeliverInput = deliverSchema.parse(req.body);

    // 1. Find the package
    const pkg = await queryOne<PackageLookupRow>(
      `SELECT id, company_id, courier_id, status
       FROM packages
       WHERE id = $1`,
      [id]
    );

    if (!pkg) {
      throw new AppError('Package not found', 404);
    }

    // 2. Role-based authorization
    if (role === 'ADMIN') {
      if (pkg.company_id !== companyId) {
        throw new AppError('Forbidden: package belongs to another company', 403);
      }
    } else if (role === 'COURIER') {
      if (pkg.courier_id !== userId) {
        throw new AppError('Forbidden: package is not assigned to you', 403);
      }
    }

    // 3. Business rule: can't deliver a package that's already delivered or cancelled
    if (pkg.status === 'DELIVERED') {
      throw new AppError('Package has already been delivered', 409);
    }
    if (pkg.status === 'CANCELLED') {
      throw new AppError('Cannot deliver a cancelled package', 409);
    }

    // 4. Determine the courier_id for the proof:
    //    - If COURIER is delivering, use their own ID
    //    - If ADMIN is delivering, use the package's assigned courier (or admin's own ID as fallback)
    const proofCourierId = role === 'COURIER' ? userId : (pkg.courier_id ?? userId);

    // ──────────────────────────────────────────
    // TRANSACTION: both operations must succeed or both rollback
    // ──────────────────────────────────────────
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 5a. Insert the delivery proof
      const proofResult = await client.query<DeliveryProofRow>(
        `INSERT INTO delivery_proofs
           (package_id, courier_id, receiver_name, receiver_ci, image_url, delivery_point)
         VALUES
           ($1, $2, $3, $4, $5,
            ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography)
         RETURNING
           id,
           package_id,
           courier_id,
           receiver_name,
           receiver_ci,
           image_url,
           ST_AsGeoJSON(delivery_point) AS delivery_point,
           created_at`,
        [
          id,
          proofCourierId,
          body.receiver_name ?? null,
          body.receiver_ci ?? null,
          body.image_url,
          body.longitude,
          body.latitude,
        ]
      );

      // 5b. Update the package status to DELIVERED
      await client.query(
        `UPDATE packages
         SET status = 'DELIVERED', updated_at = NOW()
         WHERE id = $1`,
        [id]
      );

      await client.query('COMMIT');

      const proof = proofResult.rows[0];

      res.status(201).json({
        status: 'success',
        message: 'Package delivered successfully',
        delivery_proof: proof,
      });
    } catch (txError) {
      await client.query('ROLLBACK');
      throw txError;
    } finally {
      // Always release the client back to the pool
      client.release();
    }
  } catch (error) {
    next(error);
  }
}
