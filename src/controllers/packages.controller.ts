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

const updateStatusSchema = z.object({
  status: z.enum(
    ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED'],
    { message: 'status must be one of: PICKED_UP, IN_TRANSIT, DELIVERED, FAILED, CANCELLED' }
  ),
});

type UpdateStatusInput = z.infer<typeof updateStatusSchema>;

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

interface ListPackageRow {
  id: string;
  company_id: string;
  tracking_number: string;
  customer_id: string;
  courier_id: string | null;
  destination_address: string;
  location_reference: string;
  destination_point: string;        // GeoJSON
  status: string;
  cash_to_collect: number;
  created_at: Date;
  updated_at: Date;
  customer_name: string;            // first_name + last_name from LEFT JOIN
  courier_name: string | null;      // null if no courier assigned
}

// Optional query param filter for ?status=...
const statusFilterSchema = z
  .enum(['PENDING', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED'])
  .optional();

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
 * GET /api/packages?status=PENDING
 *
 * Returns packages filtered by the authenticated user's role:
 *   ADMIN    → all packages belonging to their company
 *   COURIER  → only packages assigned to them
 *   CUSTOMER → only packages where they are the sender (customer_id)
 *
 * Supports optional query param `?status=` to narrow results.
 * Uses LEFT JOINs with users table to include customer_name and courier_name.
 */
export async function listPackages(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { userId, companyId, role } = req.user!;

    // Validate the optional status filter
    const statusFilter = statusFilterSchema.parse(req.query.status);

    // ── Build the dynamic WHERE clause ──
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    // Role-based security filter (always applied)
    if (role === 'ADMIN') {
      conditions.push(`p.company_id = $${paramIndex++}`);
      params.push(companyId);
    } else if (role === 'COURIER') {
      conditions.push(`p.courier_id = $${paramIndex++}`);
      params.push(userId);
    } else {
      // CUSTOMER — read-only, only their own shipments
      conditions.push(`p.customer_id = $${paramIndex++}`);
      params.push(userId);
    }

    // Optional status filter
    if (statusFilter) {
      conditions.push(`p.status = $${paramIndex++}`);
      params.push(statusFilter);
    }

    const whereClause = conditions.join(' AND ');

    const rows = await query<ListPackageRow>(
      `SELECT
         p.id,
         p.company_id,
         p.tracking_number,
         p.customer_id,
         p.courier_id,
         p.destination_address,
         p.location_reference,
         ST_AsGeoJSON(p.destination_point) AS destination_point,
         p.status,
         p.cash_to_collect,
         p.created_at,
         p.updated_at,
         CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
         CASE
           WHEN cr.id IS NOT NULL
           THEN CONCAT(cr.first_name, ' ', cr.last_name)
           ELSE NULL
         END AS courier_name
       FROM packages p
       LEFT JOIN users c  ON c.id  = p.customer_id
       LEFT JOIN users cr ON cr.id = p.courier_id
       WHERE ${whereClause}
       ORDER BY p.created_at DESC`,
      params
    );

    res.status(200).json({
      status: 'success',
      count: rows.length,
      packages: rows,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/packages/:id/status
 * Updates a package's status. Access rules:
 *   ADMIN   → can update any package within their company
 *   COURIER → can only update packages assigned to them (courier_id)
 *   CUSTOMER→ blocked at route level via requireRoles()
 *
 * TODO: When status transitions to 'DELIVERED', trigger creation of
 *       a delivery_proofs row (will implement in the delivery module).
 */
export async function updateStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const { userId, companyId, role } = req.user!;
    const body: UpdateStatusInput = updateStatusSchema.parse(req.body);

    // 1. Find the package and verify it exists
    const existing = await queryOne<PackageRow>(
      `SELECT id, company_id, courier_id, status
       FROM packages
       WHERE id = $1`,
      [id]
    );

    if (!existing) {
      throw new AppError('Package not found', 404);
    }

    // 2. Role-based authorization
    if (role === 'ADMIN') {
      // ADMIN can only touch packages within their own company
      if (existing.company_id !== companyId) {
        throw new AppError('Forbidden: package belongs to another company', 403);
      }
    } else if (role === 'COURIER') {
      // COURIER can only update packages assigned to them
      if (existing.courier_id !== userId) {
        throw new AppError('Forbidden: package is not assigned to you', 403);
      }
    }

    // 3. Update the status and updated_at timestamp
    const updated = await queryOne<PackageRow>(
      `UPDATE packages
       SET status = $1, updated_at = NOW()
       WHERE id = $2
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
      [body.status, id]
    );

    // TODO: if (body.status === 'DELIVERED') → create delivery_proofs row

    res.status(200).json({
      status: 'success',
      package: updated,
    });
  } catch (error) {
    next(error);
  }
}
