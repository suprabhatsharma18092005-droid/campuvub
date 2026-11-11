import { afterAll, beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const db = new PGlite();
const target = "sumit.workplac@gmail.com";
let nextId = 0;
beforeAll(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TYPE public.app_role AS ENUM ('student', 'vendor', 'admin');
    CREATE TABLE auth.users (id integer PRIMARY KEY, email text, email_confirmed_at timestamptz, last_sign_in_at timestamptz);
    CREATE TABLE public.user_roles (user_id integer, role public.app_role, UNIQUE(user_id, role));
  `);
  await db.exec(await readFile(new URL("../../drizzle/migrations/0000_restore_verified_admin_lifecycle.sql", import.meta.url), "utf8"));
});
afterAll(() => db.close());
async function create(email, verified) {
  const id = ++nextId;
  await db.query("INSERT INTO auth.users VALUES ($1,$2,$3,NULL)", [id, email, verified ? "2026-11-07T11:00:00Z" : null]);
  return id;
}
async function admin(id) {
  const { rows } = await db.query("SELECT count(*)::integer AS count FROM public.user_roles WHERE user_id=$1 AND role='admin'", [id]);
  return rows[0].count;
}
test("verified designated email receives admin on signup", async () => {
  expect(await admin(await create(target, true))).toBe(1);
});
test("unverified designated email cannot receive admin at signup or sign-in", async () => {
  const id = await create(target, false);
  await db.query("UPDATE auth.users SET last_sign_in_at=now() WHERE id=$1", [id]);
  expect(await admin(id)).toBe(0);
});
test("email confirmation grants admin automatically", async () => {
  const id = await create(target, false);
  await db.query("UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1", [id]);
  expect(await admin(id)).toBe(1);
});
test("sign-in restores the verified designated admin role without duplicates", async () => {
  const id = await create(target, true);
  await db.query("DELETE FROM public.user_roles WHERE user_id=$1", [id]);
  await db.query("UPDATE auth.users SET last_sign_in_at=now() WHERE id=$1", [id]);
  await db.query("UPDATE auth.users SET last_sign_in_at=now() WHERE id=$1", [id]);
  expect(await admin(id)).toBe(1);
});
test("other verified emails are not made admin", async () => {
  expect(await admin(await create("other@example.com", true))).toBe(0);
});
test("designated verified email match is case insensitive", async () => {
  expect(await admin(await create("SUMIT.WORKPLAC@GMAIL.COM", true))).toBe(1);
});