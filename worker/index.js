// Worker entry point.
//
// The site itself is static. This script exists because Cloudflare won't
// attach environment variables (API keys) to an assets-only Worker. Anything
// that isn't /api/* is passed to the asset server.

import { identify } from './identify.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/identify') {
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
      }
      return identify(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'not-found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Not an API route: serve static assets.
    return env.ASSETS.fetch(request);
  },
};
