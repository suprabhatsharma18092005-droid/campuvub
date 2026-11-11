import { expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

test('remixed accounts and future signups have profiles required by push devices', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, raw_user_meta_data jsonb);
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text);
      CREATE TABLE public.push_devices (token text PRIMARY KEY, user_id uuid REFERENCES public.profiles(id));
      CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN INSERT INTO public.profiles (id, full_name) VALUES (NEW.id, NEW.raw_user_meta_data->>'name')
      ON CONFLICT (id) DO NOTHING; RETURN NEW; END $$;
      INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111', '{"name":"Existing"}');
    `);
    const migration = await readFile(new URL('../../drizzle/migrations/0003_restore_profile_creation_for_push.sql', import.meta.url), 'utf8');
    await db.exec(migration);
    await db.exec(`INSERT INTO auth.users VALUES ('22222222-2222-4222-8222-222222222222', '{"name":"New"}');
      INSERT INTO public.push_devices VALUES ('existing-device','11111111-1111-4111-8111-111111111111'),
      ('new-device','22222222-2222-4222-8222-222222222222');`);
    const { rows } = await db.query('SELECT count(*)::integer AS count FROM public.push_devices');
    expect(rows[0].count).toBe(2);
    await db.exec(migration);
    const profiles = await db.query('SELECT count(*)::integer AS count FROM public.profiles');
    expect(profiles.rows[0].count).toBe(2);
  } finally { await db.close(); }
});