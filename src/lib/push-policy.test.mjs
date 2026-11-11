import { expect, test } from 'bun:test';
import { firebaseConfig, FIREBASE_PROJECT_ID, vapidKey } from './firebase-config.ts';
import { getPushTokenWithRetry, isDeadTokenError, migratePushToken } from './push-policy.ts';

test('registration uses the chosen Firebase project and sender', () => {
  expect(firebaseConfig.projectId).toBe('puch-campu');
  expect(firebaseConfig.messagingSenderId).toBe('638482616533');
  expect(firebaseConfig.appId).toBe('1:638482616533:web:da3d7885046dbcf476925c');
  expect(vapidKey).toBe('BOD87i92H1rCeZBmg5wsfr-GMjR1-TQZ0k6PzK1korGTpqQ_m6aQOs-38kITNXxuRPH_FDf6yI-pwKypZaQUT90');
});

test('old project tokens are deleted before minting and saving replacement', async () => {
  const calls = [];
  const token = await migratePushToken({
    storedProject: 'old-project',
    deleteOldToken: async () => calls.push('delete'),
    getFreshToken: async () => { calls.push('get'); return 'fresh-token'; },
    saveToken: async (value) => calls.push(`save:${value}`),
    markProject: (project) => calls.push(`mark:${project}`),
  });
  expect(token).toBe('fresh-token');
  expect(calls).toEqual(['delete', 'get', 'save:fresh-token', 'mark:puch-campu']);
});

test('current project registration does not delete its token', async () => {
  let deletes = 0;
  await migratePushToken({ storedProject: FIREBASE_PROJECT_ID,
    deleteOldToken: async () => { deletes++; }, getFreshToken: async () => 'token',
    saveToken: async () => {}, markProject: () => {},
  });
  expect(deletes).toBe(0);
});

test('failed token save does not mark migration as complete', async () => {
  let marked = false;
  await expect(migratePushToken({ storedProject: null,
    deleteOldToken: async () => {}, getFreshToken: async () => 'token',
    saveToken: async () => { throw new Error('offline'); }, markProject: () => { marked = true; },
  })).rejects.toThrow('offline');
  expect(marked).toBe(false);
});

test('UNREGISTERED tokens are pruned', () => {
  expect(isDeadTokenError(404, '{"errorCode":"UNREGISTERED"}')).toBe(true);
});

test('failed old-token cleanup does not prevent registration', async () => {
  const result = await migratePushToken({ storedProject: null,
    deleteOldToken: async () => { throw new Error('stale worker'); },
    getFreshToken: async () => 'fresh', saveToken: async () => {}, markProject: () => {},
  });
  expect(result).toBe('fresh');
});

test('a stale subscription is cleaned and token retrieval retried exactly once', async () => {
  let attempts = 0;
  let cleanup = 0;
  const result = await getPushTokenWithRetry({
    getToken: async () => { attempts++; if (attempts === 1) throw new Error('stale'); return 'fresh'; },
    unsubscribe: async () => { cleanup++; throw new Error('cleanup unavailable'); },
  });
  expect(result).toBe('fresh');
  expect(attempts).toBe(2);
  expect(cleanup).toBe(1);
});

test('retry preserves the final token error without further attempts', async () => {
  let attempts = 0;
  await expect(getPushTokenWithRetry({
    getToken: async () => { attempts++; throw new Error('permission failed'); },
    unsubscribe: async () => {},
  })).rejects.toThrow('permission failed');
  expect(attempts).toBe(2);
});
test('SENDER_ID_MISMATCH tokens are pruned', () => {
  expect(isDeadTokenError(403, '{"errorCode":"SENDER_ID_MISMATCH"}')).toBe(true);
});
test('project 404 and permission errors do not erase valid tokens', () => {
  expect(isDeadTokenError(404, '{"status":"NOT_FOUND"}')).toBe(false);
  expect(isDeadTokenError(403, '{"status":"PERMISSION_DENIED"}')).toBe(false);
});