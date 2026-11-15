import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import { defineConfig, type Plugin } from 'vitest/config';
import type * as LeaderboardCore from './src/online/leaderboard-core.ts';
import type * as BanterCore from './src/online/banter-core.ts';
import type * as BanterWriter from './netlify/lib/banter-writer.ts';

/** Reads a Node request into a web Request, the shape the shared handlers take. */
async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk as Uint8Array);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  const hasBody = req.method === 'POST' && chunks.length > 0;
  return new Request(`http://localhost${req.url ?? '/'}`, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(await response.text());
}

/**
 * The same leaderboard and banter rules the Netlify Functions run, served by the dev server,
 * so both can be tried locally. The game's own modules are loaded through Vite at request time.
 * The leaderboard forgets everything when the server stops. Banter only works here if
 * ANTHROPIC_API_KEY is set in the shell that started the server.
 */
function devApi(): Plugin {
  let leaderboardStore: LeaderboardCore.MemoryStore | null = null;
  let banterStore: LeaderboardCore.MemoryStore | null = null;
  const load = async (server: ViteDevServer) => {
    const core = (await server.ssrLoadModule('/src/online/leaderboard-core.ts')) as typeof LeaderboardCore;
    leaderboardStore ??= new core.MemoryStore();
    banterStore ??= new core.MemoryStore();
    return { core, leaderboardStore, banterStore };
  };
  return {
    name: 'beporowa-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const clientIp = req.socket.remoteAddress ?? '';
        if (url.startsWith('/api/leaderboard')) {
          void Promise.all([toRequest(req), load(server)])
            .then(([request, { core, leaderboardStore: store }]) => core.handleLeaderboard(request, { store, now: () => Date.now(), clientIp }))
            .then((response) => send(res, response))
            .catch(next);
          return;
        }
        if (url.startsWith('/api/banter')) {
          void Promise.all([toRequest(req), load(server), server.ssrLoadModule('/src/online/banter-core.ts') as Promise<typeof BanterCore>])
            .then(async ([request, { banterStore: store }, banter]) => {
              const writer = process.env.ANTHROPIC_API_KEY
                ? ((await server.ssrLoadModule('/netlify/lib/banter-writer.ts')) as typeof BanterWriter).createBanterWriter(process.env.BANTER_MODEL || undefined)
                : null;
              return banter.handleBanter(request, { store, now: () => Date.now(), clientIp, write: writer });
            })
            .then((response) => send(res, response))
            .catch(next);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [devApi()],
  build: {
    target: 'es2022',
    // Rapier's compat build inlines its WASM as base64, so its chunk is big on purpose.
    chunkSizeWarningLimit: 5800,
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
});
