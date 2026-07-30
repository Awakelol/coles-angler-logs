// ---------------------------------------------------------------------------
// Worker entry.
//
// The site is static; this script exists so there is somewhere for the API
// keys to live. A Worker serving only assets cannot have environment
// variables attached — Cloudflare says so plainly: "Variables cannot be added
// to a Worker that only has static assets." Declaring `main` in
// wrangler.jsonc gives it code, and the keys attach to that.
//
// Everything that isn't /api/* is handed straight back to the asset server.
// ---------------------------------------------------------------------------

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

    // Not ours — let the static asset server answer.
    return env.ASSETS.fetch(request);
  },
};
