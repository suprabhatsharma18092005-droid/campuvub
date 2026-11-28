import { expect, test } from "bun:test";
import {
  STORE_NAME_SETTING_KEY,
  SUPER_ADMIN_EMAIL,
  addAdminGrant,
  emptyAdminAccessState,
  getStoreName,
  isSuperAdminEmail,
  parseAdminAccessState,
  removeAdminGrant,
} from "./admin-access.ts";

test("identifies Super Admin email case-insensitively and protects against removal", () => {
  expect(isSuperAdminEmail(SUPER_ADMIN_EMAIL)).toBe(true);
  expect(isSuperAdminEmail("  SUMIT.WORKPLAC@GMAIL.COM  ")).toBe(true);
  expect(isSuperAdminEmail("someone@example.com")).toBe(false);

  expect(() =>
    removeAdminGrant(emptyAdminAccessState(), { email: "SUMIT.WORKPLAC@GMAIL.COM" }),
  ).toThrow("Super Admin cannot be removed.");
});

test("grants and revokes delegated admins cleanly with deduplication", () => {
  let state = emptyAdminAccessState();
  state = addAdminGrant(state, {
    userId: "u-1",
    email: "Helper@Example.com",
    name: "Rahul",
    grantedBy: SUPER_ADMIN_EMAIL,
    nowIso: "2026-11-28T01:00:00Z",
  });
  expect(state.admins).toHaveLength(1);
  expect(state.admins[0]?.email).toBe("helper@example.com");

  // Re-adding same email updates in place without duplicating
  state = addAdminGrant(state, {
    userId: "u-1",
    email: "helper@example.com",
    name: "Rahul Sharma",
    grantedBy: SUPER_ADMIN_EMAIL,
    nowIso: "2026-11-28T02:00:00Z",
  });
  expect(state.admins).toHaveLength(1);
  expect(state.admins[0]?.name).toBe("Rahul Sharma");

  // Round-trip serialization ignores any accidental Super Admin row
  const serialized = JSON.stringify({
    ...state,
    admins: [
      ...state.admins,
      { email: SUPER_ADMIN_EMAIL, grantedAt: "2026-11-28T00:00:00Z", grantedBy: SUPER_ADMIN_EMAIL },
    ],
  });
  const parsed = parseAdminAccessState(serialized);
  expect(parsed.admins).toHaveLength(1);

  // Removing delegated admin succeeds
  const afterRemove = removeAdminGrant(parsed, { userId: "u-1", email: "helper@example.com" });
  expect(afterRemove.admins).toHaveLength(0);
});

test("reads and trims custom store name safely", () => {
  expect(getStoreName({})).toBe("");
  expect(getStoreName({ [STORE_NAME_SETTING_KEY]: "   Hostel Mart   " })).toBe("Hostel Mart");
  expect(getStoreName({ [STORE_NAME_SETTING_KEY]: "A".repeat(80) })).toHaveLength(60);
});
