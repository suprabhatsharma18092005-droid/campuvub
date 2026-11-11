import { FIREBASE_PROJECT_ID } from './firebase-config';

export function isDeadTokenError(_status: number, body: string): boolean {
  // Only explicit device errors: an unrelated project/endpoint 404 is not a dead device.
  return /\b(UNREGISTERED|SENDER_ID_MISMATCH)\b/.test(body);
}

/** Commit the project marker only after the fresh token is safely saved. */
export async function migratePushToken(options: {
  storedProject: string | null;
  deleteOldToken: () => Promise<unknown>;
  getFreshToken: () => Promise<string>;
  saveToken: (token: string) => Promise<unknown>;
  markProject: (project: string) => void;
}): Promise<string> {
  if (options.storedProject !== FIREBASE_PROJECT_ID) {
    try { await options.deleteOldToken(); } catch { /* Cleanup never blocks registration. */ }
  }
  const token = await options.getFreshToken();
  if (!token) return '';
  await options.saveToken(token);
  options.markProject(FIREBASE_PROJECT_ID);
  return token;
}

/** Recover a stale browser subscription once; preserve the final registration error. */
export async function getPushTokenWithRetry(options: {
  getToken: () => Promise<string>;
  unsubscribe: () => Promise<unknown>;
}): Promise<string> {
  try { return await options.getToken(); }
  catch {
    try { await options.unsubscribe(); } catch { /* Best-effort cleanup. */ }
    return options.getToken();
  }
}
