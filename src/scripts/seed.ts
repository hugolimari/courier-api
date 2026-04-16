/**
 * Seed script for Developer Testing
 * Run with: npx ts-node src/scripts/seed.ts
 *
 * Creates:
 *  - 1 Company: Courier SaaS Bolivia
 *  - 4 Users: 1 ADMIN, 2 COURIER, 1 CUSTOMER
 *  - 5 Packages in various states, assigned to couriers
 */

import bcrypt from 'bcrypt';
import { pool } from '../config/db';
import { testConnection } from '../config/db';

// ── Hardcoded UUIDs for repeatability ────────────────────────────────────────
const COMPANY_ID  = 'aaaaaaaa-0000-0000-0000-000000000001';
const ADMIN_ID    = 'bbbbbbbb-0000-0000-0000-000000000001';
const COURIER1_ID = 'cccccccc-0000-0000-0000-000000000001';
const COURIER2_ID = 'cccccccc-0000-0000-0000-000000000002';
const CUSTOMER_ID = 'dddddddd-0000-0000-0000-000000000001';

// ── Cochabamba coordinates ────────────────────────────────────────────────────
const LOCATIONS = [
  { address: 'Plaza 14 de Septiembre, Centro, Cochabamba', ref: 'Frente a la Catedral', lat: -17.3935, lng: -66.1568 },
  { address: 'Av. América E-0435, Cochabamba', ref: 'Edificio Los Tiempos, piso 2', lat: -17.3800, lng: -66.1488 },
  { address: 'Av. Blanco Galindo Km 5, Quillacollo', ref: 'Mercado central, puerta norte', lat: -17.3963, lng: -66.2102 },
  { address: 'Calle Sucre y España, Cochabamba', ref: 'Local rojo, cerca del Banco Unión', lat: -17.3920, lng: -66.1610 },
  { address: 'Av. Petrolera Km 2.5, Sacaba', ref: 'Barrio San Isidro, casa esquina', lat: -17.3782, lng: -66.0843 },
];

async function seed() {
  await testConnection();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── 0. Clean existing seed data ──────────────────────────────────────────
    console.log('🧹 Cleaning previous seed data...');
    // Delete by known emails first (handles users created with different company_id)
    const knownEmails = ['hugo@courier.bo', 'carlos@courier.bo', 'sofia@courier.bo', 'tienda@courier.bo'];
    for (const email of knownEmails) {
      const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length > 0) {
        const uid = existing.rows[0].id;
        await client.query(`DELETE FROM delivery_proofs WHERE courier_id = $1`, [uid]);
        await client.query(`DELETE FROM courier_tracking WHERE courier_id = $1`, [uid]);
        await client.query(`DELETE FROM packages WHERE courier_id = $1 OR customer_id = $1`, [uid]);
      }
    }
    await client.query(`DELETE FROM packages WHERE company_id = $1`, [COMPANY_ID]);
    await client.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [knownEmails]);
    await client.query(`DELETE FROM companies WHERE id = $1`, [COMPANY_ID]);

    // ── 1. Company ─────────────────────────────────────────────────────────
    console.log('🏢 Creating company...');
    await client.query(`
      INSERT INTO companies (id, name, nit)
      VALUES ($1, 'Courier SaaS Bolivia', '1234567890')
    `, [COMPANY_ID]);

    // ── 2. Users ──────────────────────────────────────────────────────────
    console.log('👤 Creating users...');
    const password = await bcrypt.hash('Test1234!', 10);

    const users = [
      { id: ADMIN_ID,    role: 'ADMIN',    email: 'hugo@courier.bo',    first: 'Hugo',    last: 'Limari',   phone: '70012345' },
      { id: COURIER1_ID, role: 'COURIER',  email: 'carlos@courier.bo',  first: 'Carlos',  last: 'Mamani',   phone: '71123456' },
      { id: COURIER2_ID, role: 'COURIER',  email: 'sofia@courier.bo',   first: 'Sofía',   last: 'Quispe',   phone: '72234567' },
      { id: CUSTOMER_ID, role: 'CUSTOMER', email: 'tienda@courier.bo',  first: 'Tienda',  last: 'Digital',  phone: '73345678' },
    ];

    for (const u of users) {
      await client.query(`
        INSERT INTO users (id, company_id, first_name, last_name, email, password_hash, role, phone_number)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [u.id, COMPANY_ID, u.first, u.last, u.email, password, u.role, u.phone]);
      console.log(`   ✓ ${u.role}: ${u.email} / Test1234!`);
    }

    // ── 3. Packages ───────────────────────────────────────────────────────
    console.log('📦 Creating packages...');

    const packages = [
      {
        tracking: 'CR-20260416-SEEDS1',
        courier: COURIER1_ID,
        location: LOCATIONS[0],
        status: 'PENDING',
        cash: 0,
      },
      {
        tracking: 'CR-20260416-SEEDS2',
        courier: COURIER1_ID,
        location: LOCATIONS[1],
        status: 'PICKED_UP',
        cash: 50,
      },
      {
        tracking: 'CR-20260416-SEEDS3',
        courier: COURIER1_ID,
        location: LOCATIONS[2],
        status: 'IN_TRANSIT',
        cash: 120,
      },
      {
        tracking: 'CR-20260416-SEEDS4',
        courier: COURIER2_ID,
        location: LOCATIONS[3],
        status: 'PENDING',
        cash: 0,
      },
      {
        tracking: 'CR-20260416-SEEDS5',
        courier: COURIER2_ID,
        location: LOCATIONS[4],
        status: 'DELIVERED',
        cash: 80,
      },
    ];

    for (const pkg of packages) {
      await client.query(`
        INSERT INTO packages
          (company_id, tracking_number, customer_id, courier_id,
           destination_address, location_reference, destination_point,
           status, cash_to_collect)
        VALUES
          ($1, $2, $3, $4, $5, $6,
           ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
           $9, $10)
      `, [
        COMPANY_ID,
        pkg.tracking,
        CUSTOMER_ID,
        pkg.courier,
        pkg.location.address,
        pkg.location.ref,
        pkg.location.lng,
        pkg.location.lat,
        pkg.status,
        pkg.cash,
      ]);
      console.log(`   ✓ [${pkg.status.padEnd(11)}] ${pkg.tracking} → ${pkg.location.address.substring(0, 40)}...`);
    }

    // ── 4. Courier tracking (active GPS positions) ─────────────────────────
    console.log('📡 Seeding courier GPS locations...');
    await client.query(`
      INSERT INTO courier_tracking (courier_id, current_location, last_update)
      VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, NOW())
    `, [COURIER1_ID, -66.1568, -17.3920]);

    await client.query(`
      INSERT INTO courier_tracking (courier_id, current_location, last_update)
      VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, NOW())
      ON CONFLICT (courier_id) DO UPDATE
        SET current_location = EXCLUDED.current_location,
            last_update      = EXCLUDED.last_update
    `, [COURIER2_ID, -66.1600, -17.3850]);

    await client.query('COMMIT');

    console.log('\n✅ Seed completed successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ROLE       EMAIL                PASSWORD');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ADMIN      hugo@courier.bo      Test1234!');
    console.log('  COURIER    carlos@courier.bo    Test1234!');
    console.log('  COURIER    sofia@courier.bo     Test1234!');
    console.log('  CUSTOMER   tienda@courier.bo    Test1234!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n  Paquetes de Carlos: SEEDS1 (PENDING), SEEDS2 (PICKED_UP), SEEDS3 (IN_TRANSIT)');
    console.log('  Paquetes de Sofía:  SEEDS4 (PENDING),  SEEDS5 (DELIVERED)\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Seed failed — rolled back.\n', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
