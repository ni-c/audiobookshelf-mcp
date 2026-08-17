import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import {
  assertPathSegment,
  AudiobookshelfApi,
  AudiobookshelfApiError,
  query,
} from '../src/api.js';
import type { Config } from '../src/config.js';

const config: Config = {
  url: 'https://abs.example.com',
  apiKey: 'test-key',
  insecureTls: false,
  readOnly: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('assertPathSegment', () => {
  it('accepts Audiobookshelf ids in both formats', () => {
    expect(assertPathSegment('li_bcd8lkdnvksjdlkf', 'id')).toBe(
      'li_bcd8lkdnvksjdlkf'
    );
    expect(
      assertPathSegment('4f4e0d1a-2f4e-4f0a-9f7e-2b1c3d4e5f60', 'id')
    ).toBe('4f4e0d1a-2f4e-4f0a-9f7e-2b1c3d4e5f60');
  });

  it('rejects path traversal and separators', () => {
    for (const bad of ['../admin', 'a/b', '..', '.', 'a b', 'a%2fb']) {
      expect(() => assertPathSegment(bad, 'id')).toThrow(/invalid id/);
    }
  });
});

describe('query', () => {
  it('omits undefined values and maps booleans to 1/0', () => {
    expect(query({ a: 1, b: undefined, c: true, d: false })).toBe(
      '?a=1&c=1&d=0'
    );
  });

  it('percent-encodes the base64 padding of a filter value', () => {
    // '+' and '=' in a base64 filter must survive the trip; an unencoded '+'
    // would arrive at the server as a space.
    const encoded = query({ filter: 'authors.YWJjKz8/' });
    expect(encoded).toBe('?filter=authors.YWJjKz8%2F');
    expect(new URL(`https://x${encoded}`).searchParams.get('filter')).toBe(
      'authors.YWJjKz8/'
    );
  });

  it('returns an empty string when nothing is set', () => {
    expect(query({ a: undefined })).toBe('');
  });
});

describe('AudiobookshelfApi', () => {
  it('sends the API key as a bearer token and never follows redirects', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ok: true }));

    const api = new AudiobookshelfApi(config);
    await expect(api.get('/api/libraries')).resolves.toEqual({ ok: true });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://abs.example.com/api/libraries');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-key'
    );
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeDefined();
    fetchSpy.mockRestore();
  });

  it('refuses to call the API without credentials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const api = new AudiobookshelfApi({
      ...config,
      url: undefined,
      apiKey: undefined,
    });
    await expect(api.get('/api/libraries')).rejects.toThrow(
      /AUDIOBOOKSHELF_URL/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('turns a non-2xx response into an AudiobookshelfApiError', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('nope', { status: 403 }));
    const api = new AudiobookshelfApi(config);
    await expect(api.get('/api/me')).rejects.toBeInstanceOf(
      AudiobookshelfApiError
    );
    fetchSpy.mockRestore();
  });

  it('returns text unchanged when the response is not JSON', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('OK', { status: 200 }));
    const api = new AudiobookshelfApi(config);
    await expect(api.get('/status')).resolves.toBe('OK');
    fetchSpy.mockRestore();
  });

  it('serializes a JSON body and sets the content type', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({}));
    const api = new AudiobookshelfApi(config);
    await api.patch('/api/me/progress/li_a', { currentTime: 10 });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"currentTime":10}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json'
    );
    fetchSpy.mockRestore();
  });
});

describe('AudiobookshelfApi transport', () => {
  it('returns the raw text when a JSON content type carries invalid JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{ this is not json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    await expect(new AudiobookshelfApi(config).get('/api/x')).resolves.toBe(
      '{ this is not json'
    );
    vi.restoreAllMocks();
  });

  it('scopes relaxed TLS to its own dispatcher instead of the whole process', async () => {
    const before = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    const globalFetch = vi.spyOn(globalThis, 'fetch');

    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;

    try {
      const api = new AudiobookshelfApi({
        ...config,
        url: `http://127.0.0.1:${port}`,
        insecureTls: true,
      });
      await expect(api.get('/api/libraries')).resolves.toEqual({
        ok: true,
        path: '/api/libraries',
      });
      // The insecure path uses undici's own fetch, not the global one, so a
      // test stub of global fetch stays untouched — and nothing global is
      // weakened for unrelated requests.
      expect(globalFetch).not.toHaveBeenCalled();
      expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(before);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      vi.restoreAllMocks();
    }
  });
});
