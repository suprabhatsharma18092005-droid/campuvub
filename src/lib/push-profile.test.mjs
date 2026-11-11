import { expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { migrationSection } from './testing/migration-sql.mjs';

test('remixed accounts and future signups have profiles required by push devices', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE SCHEMA auth;
      CREATE TYPE public.app_role AS ENUM ('student', 'vendor', 'admin');
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text);
      CREATE TABLE public.user_roles (user_id uuid, role public.app_role, UNIQUE (user_id, role));
      CREATE TABLE public.push_devices (token text PRIMARY KEY, user_id uuid REFERENCES public.profiles(id));
      INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111', 'a@example.com', now(), '{"name":"Existing"}');
    `);
    await db.exec(await migrationSection('-- ===== Auth lifecycle', '-- ===== Designated admin'));
    const backfill = await migrationSection('-- Backfill any accounts', '-- ===== Storage access rules');
    await db.exec(backfill);
    await db.exec(`INSERT INTO auth.users VALUES ('22222222-2222-4222-8222-222222222222', 'b@example.com', NULL, '{"name":"New"}');
      INSERT INTO public.push_devices VALUES ('existing-device','11111111-1111-4111-8111-111111111111'),
      ('new-device','22222222-2222-4222-8222-222222222222');`);
    const { rows } = await db.query('SELECT count(*)::integer AS count FROM public.push_devices');
    expect(rows[0].count).toBe(2);
    await db.exec(backfill);
    const profiles = await db.query('SELECT count(*)::integer AS count FROM public.profiles');
    expect(profiles.rows[0].count).toBe(2);
  } finally { await db.close(); }
});
