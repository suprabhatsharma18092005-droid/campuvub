import { expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const DEV1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEV2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKEN = 'token-one-1234567890';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, fcm_token text);
    CREATE TABLE public.push_devices (
      token text PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      device_id uuid NOT NULL, project_id text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, device_id));
  `);
  await db.exec(await readFile(new URL('../../drizzle/migrations/0004_register_push_device_rpc.sql', import.meta.url), 'utf8'));
  return db;
}
const as = (db, uid) => db.exec(`SELECT set_config('test.uid', '${uid}', false)`);
const register = (db, token, device) =>
  db.query('SELECT public.register_push_device($1, $2, $3)', [token, device, 'puch-campu']);
const devices = async (db) => (await db.query('SELECT token, user_id, device_id FROM public.push_devices ORDER BY token')).rows;

test('signed-out callers cannot save a device', async () => {
  const db = await setup();
  try {
    await as(db, '');
    await expect(register(db, TOKEN, DEV1)).rejects.toThrow('Not signed in');
    expect(await devices(db)).toEqual([]);
  } finally { await db.close(); }
});

test('saving a device creates the missing profile and stores the token for the caller only', async () => {
  const db = await setup();
  try {
    await as(db, A);
    await register(db, TOKEN, DEV1);
    expect(await devices(db)).toEqual([{ token: TOKEN, user_id: A, device_id: DEV1 }]);
    const { rows } = await db.query('SELECT fcm_token FROM public.profiles WHERE id = $1', [A]);
    expect(rows[0].fcm_token).toBe(TOKEN);
  } finally { await db.close(); }
});

test('re-registering the same device replaces its token instead of failing on duplicates', async () => {
  const db = await setup();
  try {
    await as(db, A);
    await register(db, TOKEN, DEV1);
    await register(db, TOKEN, DEV1);
    await register(db, 'token-two-1234567890', DEV1);
    expect(await devices(db)).toEqual([{ token: 'token-two-1234567890', user_id: A, device_id: DEV1 }]);
  } finally { await db.close(); }
});

test('a browser switching accounts moves its token to the new signed-in user', async () => {
  const db = await setup();
  try {
    await as(db, A);
    await register(db, TOKEN, DEV1);
    await as(db, B);
    await register(db, TOKEN, DEV2);
    expect(await devices(db)).toEqual([{ token: TOKEN, user_id: B, device_id: DEV2 }]);
    const { rows } = await db.query('SELECT fcm_token FROM public.profiles WHERE id = $1', [A]);
    expect(rows[0].fcm_token).toBe(null);
  } finally { await db.close(); }
});

test('invalid tokens are rejected', async () => {
  const db = await setup();
  try {
    await as(db, A);
    await expect(register(db, 'short', DEV1)).rejects.toThrow('Invalid notification token');
  } finally { await db.close(); }
});

test('signed-out visitors are not allowed to call the function', async () => {
  const db = await setup();
  try {
    const { rows } = await db.query(`SELECT has_function_privilege('anon', 'public.register_push_device(text, uuid, text)', 'EXECUTE') AS anon,
      has_function_privilege('authenticated', 'public.register_push_device(text, uuid, text)', 'EXECUTE') AS authed`);
    expect(rows[0]).toEqual({ anon: false, authed: true });
  } finally { await db.close(); }
});
