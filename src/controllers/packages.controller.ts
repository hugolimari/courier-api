import { Request, Response, NextFunction } from 'express';
import * as z from 'zod';
import { query, queryOne } from '../helpers/db.helper';
import { Package } from '../types/entities';
import { AppError } from '../middlewares/error.middleware';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Generates a unique tracking number.
 * Format: CR-YYYYMMDD-XXXXX (e.g. CR-20260416-A3K9Z)
 * CR = Courier, followed by date and 5 random alphanumeric chars.
 */
function generateTrackingNumber(): string {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, ''); // "20260416"
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `CR-${dateStr}-${random}`;
}

// ─────────────────────────────────────────────
// Zod Schemas
// ─────────────────────────────────────────────

const createPackageSchema = z.object({
  customer_id: z.string().uuid({ message: 'customer_id must be a valid UUID' }),
  courier_id: z.string().uuid({ message: 'courier_id must be a valid UUID' }).optional(),
  destination_address: z.string().min(5, 'destination_address is required'),
  location_reference: z.string().min(3, 'location_reference is required (Bolivian addressing standard)'),
  // Coordinates received as { longitude, latitude } — stored as PostGIS GEOGRAPHY(POINT)
  longitude: z
    .number({ message: 'longitude must be a number between -180 and 180' })
    .min(-180).max(180),
  latitude: z
    .number({ message: 'latitude must be a number between -90 and 90' })
    .min(-90).max(90),
  cash_to_collect: z.number().min(0).default(0),
});

type CreatePackageInput = z.infer<typeof createPackageSchema>;

// ─────────────────────────────────────────────
// Row types for SQL queries
// ─────────────────────────────────────────────

interface PackageRow extends Omit<Package, 'destination_point'> {
  destination_point: string; // GeoJSON string from ST_AsGeoJSON()
}

interface TrackingRow {
  tracking_number: string;
  status: string;
  destination_address: string;
  location_reference: string;
  destination_point: string;        // GeoJSON
  cash_to_collect: number;
  created_at: Date;
  updated_at: Date;
  courier_location: string | null;  // GeoJSON from courier_tracking, null if unassigned
  courier_last_update: Date | null;
}

// ─────────────────────────────────────────────
// Controllers
// ─────────────────────────────────────────────

/**
 * POST /api/packages
 * Creates a new package. ADMIN only.
 * The company_id is always taken from the JWT — never from the request body.
 */
export async function createPackage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body: CreatePackageInput = createPackageSchema.parse(req.body);
    const { companyId } = req.user!;

    const tracking_number = generateTrackingNumber();

    // ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
    // SRID 4326 = WGS84 — the standard GPS coordinate system
    const newPackage = await queryOne<PackageRow>(
      `INSERT INTO packages
         (company_id, tracking_number, customer_id, courier_id,
          destination_address, location_reference, destination_point,
          cash_to_collect, status)
       VALUES
         ($1, $2, $3, $4, $5, $6,
          ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
          $9, 'PENDING')
       RETURNING
         id,
         company_id,
         tracking_number,
         customer_id,
         courier_id,
         destination_address,
         location_reference,
         ST_AsGeoJSON(destination_point) AS destination_point,
         status,
         cash_to_collect,
         created_at,
         updated_at`,
      [
        companyId,
        tracking_number,
        body.customer_id,
        body.courier_id ?? null,
        body.destination_address,
        body.location_reference,
        body.longitude,
        body.latitude,
        body.cash_to_collect,
      ]
    );

    if (!newPackage) {
      throw new AppError('Failed to create package', 500);
    }

    res.status(201).json({
      status: 'success',
      package: newPackage,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/packages/track/:tracking_number
 * PUBLIC endpoint — no authentication required.
 * Returns safe tracking info for the final recipient.
 * Deliberately omits: customer_id, company_id, courier personal data.
 */
export async function trackPackage(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { tracking_number } = req.params;

    const result = await queryOne<TrackingRow>(
      `SELECT
         p.tracking_number,
         p.status,
         p.destination_address,
         p.location_reference,
         ST_AsGeoJSON(p.destination_point)  AS destination_point,
         p.cash_to_collect,
         p.created_at,
         p.updated_at,
         ST_AsGeoJSON(ct.current_location)  AS courier_location,
         ct.last_update                     AS courier_last_update
       FROM packages p
       LEFT JOIN courier_tracking ct ON ct.courier_id = p.courier_id
       WHERE p.tracking_number = $1`,
      [tracking_number]
    );

    if (!result) {
      throw new AppError('Package not found', 404);
    }

    res.status(200).json({
      status: 'success',
      package: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/packages
 * Returns packages filtered by the authenticated user's role:
 *   ADMIN   → all packages belonging to their company
 *   COURIER → only packages assigned to them
 *   CUSTOMER→ only packages where they are the sender (customer_id)
 */
export async function listPackages(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { userId, companyId, role } = req.user!;

    let rows: PackageRow[];

    if (role === 'ADMIN') {
      rows = await query<PackageRow>(
        `SELECT
           id, company_id, tracking_number, customer_id, courier_id,
           destination_address, location_reference,
           ST_AsGeoJSON(destination_point) AS destination_point,
           status, cash_to_collect, created_at, updated_at
         FROM packages
         WHERE company_id = $1
         ORDER BY created_at DESC`,
        [companyId]
      );
    } else if (role === 'COURIER') {
      rows = await query<PackageRow>(
        `SELECT
           id, company_id, tracking_number, customer_id, courier_id,
           destination_address, location_reference,
           ST_AsGeoJSON(destination_point) AS destination_point,
           status, cash_to_collect, created_at, updated_at
         FROM packages
         WHERE courier_id = $1
         ORDER BY created_at DESC`,
        [userId]
      );
    } else {
      // CUSTOMER — read-only, only their own shipments
      rows = await query<PackageRow>(
        `SELECT
           id, tracking_number,
           destination_address, location_reference,
           ST_AsGeoJSON(destination_point) AS destination_point,
           status, cash_to_collect, created_at, updated_at
         FROM packages
         WHERE customer_id = $1
         ORDER BY created_at DESC`,
        [userId]
      );
    }

    res.status(200).json({
      status: 'success',
      count: rows.length,
      packages: rows,
    });
  } catch (error) {
    next(error);
  }
}
