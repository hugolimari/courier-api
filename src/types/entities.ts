// ─────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────

export type UserRole = 'ADMIN' | 'COURIER' | 'CUSTOMER';

export type PackageStatus =
  | 'PENDING'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED';

// ─────────────────────────────────────────────
// Entity Interfaces
// ─────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  nit: string;
  created_at: Date;
}

export interface User {
  id: string;
  company_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  second_last_name: string | null;
  email: string;
  password_hash: string;
  role: UserRole;
  phone_number: string;
  created_at: Date;
}

export interface Package {
  id: string;
  company_id: string;
  tracking_number: string;
  customer_id: string;
  courier_id: string | null;
  destination_address: string;
  location_reference: string;
  destination_point: string; // GEOGRAPHY(POINT) — NOT NULL, stored as WKT/hex by pg
  status: PackageStatus;
  cash_to_collect: number;   // NOT NULL DEFAULT 0
  created_at: Date;
  updated_at: Date;
}

export interface DeliveryProof {
  id: string;
  package_id: string;
  courier_id: string;
  receiver_name: string | null;
  receiver_ci: string | null;
  image_url: string;
  delivery_point: string;    // GEOGRAPHY(POINT) — NOT NULL
  created_at: Date;
}

export interface CourierTracking {
  courier_id: string;        // PK — references users.id
  current_location: string;  // GEOGRAPHY(POINT)
  last_update: Date;
}
