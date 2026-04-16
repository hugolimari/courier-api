import { Request, Response, NextFunction } from 'express';
import * as z from 'zod';
import { queryOne } from '../helpers/db.helper';
import { AppError } from '../middlewares/error.middleware';

// ─────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────

const updateLocationSchema = z.object({
  longitude: z
    .number({ message: 'longitude must be a number between -180 and 180' })
    .min(-180).max(180),
  latitude: z
    .number({ message: 'latitude must be a number between -90 and 90' })
    .min(-90).max(90),
});

type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

// ─────────────────────────────────────────────
// Row type
// ─────────────────────────────────────────────

interface TrackingLocationRow {
  courier_id: string;
  current_location: string; // GeoJSON from ST_AsGeoJSON()
  last_update: Date;
}

// ─────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────

/**
 * PATCH /api/tracking
 *
 * Upserts the courier's current GPS location.
 * Called recurrently by the courier's mobile app (every 30-60s).
 *
 * Uses PostgreSQL ON CONFLICT (courier_id) DO UPDATE to handle
 * both first-time inserts and subsequent location updates in a single query.
 *
 * Access: COURIER only (enforced by requireRoles at route level).
 * The courier_id always comes from the JWT — a courier can only
 * update their own location, never someone else's.
 */
export async function updateLocation(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { userId } = req.user!;
    const body: UpdateLocationInput = updateLocationSchema.parse(req.body);

    // UPSERT: insert if courier has no tracking row yet, update if they do.
    // courier_id is the PK of courier_tracking, so ON CONFLICT handles the logic.
    const result = await queryOne<TrackingLocationRow>(
      `INSERT INTO courier_tracking
         (courier_id, current_location, last_update)
       VALUES
         ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, NOW())
       ON CONFLICT (courier_id)
       DO UPDATE SET
         current_location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
         last_update = NOW()
       RETURNING
         courier_id,
         ST_AsGeoJSON(current_location) AS current_location,
         last_update`,
      [userId, body.longitude, body.latitude]
    );

    if (!result) {
      throw new AppError('Failed to update location', 500);
    }

    res.status(200).json({
      status: 'success',
      tracking: result,
    });
  } catch (error) {
    next(error);
  }
}
