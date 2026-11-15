/**
 * Optional rival and DJ lines written live by Claude, as a Netlify Function.
 * Off in the game unless a player turns it on, and off here unless ANTHROPIC_API_KEY is set.
 * The rules and checks live in src/online/banter-core.ts.
 */

import { getStore } from '@netlify/blobs';
import { handleBanter } from '../../src/online/banter-core';
import type { KeyValueStore } from '../../src/online/leaderboard-core';
import { createBanterWriter } from '../lib/banter-writer';

interface FunctionContext {
  ip?: string;
}

function blobStore(): KeyValueStore {
  const store = getStore({ name: 'beporowa-banter', consistency: 'strong' });
  return {
    get: (key) => store.get(key, { type: 'json' }),
    set: async (key, value) => {
      await store.setJSON(key, value);
    },
    delete: (key) => store.delete(key),
  };
}

export default async (request: Request, context: FunctionContext): Promise<Response> => {
  return handleBanter(request, {
    store: blobStore(),
    now: () => Date.now(),
    clientIp: context.ip ?? request.headers.get('x-nf-client-connection-ip') ?? '',
    write: process.env.ANTHROPIC_API_KEY ? createBanterWriter(process.env.BANTER_MODEL || undefined) : null,
    salt: process.env.LEADERBOARD_SALT,
  });
};

export const config = { path: '/api/banter' };
