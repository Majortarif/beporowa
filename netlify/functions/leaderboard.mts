/**
 * The online leaderboard, as a Netlify Function. Runs are kept in Netlify Blobs.
 * All the rules live in src/online/leaderboard-core.ts, which the dev server and tests share.
 */

import { getStore } from '@netlify/blobs';
import { handleLeaderboard, type KeyValueStore } from '../../src/online/leaderboard-core';

/** The bits of Netlify's context this function reads. */
interface FunctionContext {
  ip?: string;
}

function blobStore(): KeyValueStore {
  const store = getStore({ name: 'beporowa-leaderboard', consistency: 'strong' });
  return {
    get: (key) => store.get(key, { type: 'json' }),
    set: async (key, value) => {
      await store.setJSON(key, value);
    },
    delete: (key) => store.delete(key),
  };
}

export default async (request: Request, context: FunctionContext): Promise<Response> => {
  return handleLeaderboard(request, {
    store: blobStore(),
    now: () => Date.now(),
    clientIp: context.ip ?? request.headers.get('x-nf-client-connection-ip') ?? '',
    salt: process.env.LEADERBOARD_SALT,
  });
};

export const config = { path: '/api/leaderboard' };
