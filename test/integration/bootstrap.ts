import { assertLoopback, waitForHttp } from 'mcp-integration-harness';

/**
 * Brings the throwaway Audiobookshelf from first start to a scanned library.
 *
 * Four steps, and three of them have a trap:
 *
 *  - **`POST /init`** creates the first account. It answers the string `OK`
 *    rather than JSON, and it is the only way in: there is no environment
 *    variable that seeds an admin.
 *  - **`POST /login`** returns the token under `user.accessToken`, not at the
 *    top level.
 *  - **`POST /api/api-keys` requires `userId`.** Without it the answer is a
 *    bare `Bad Request` with no indication of which field is missing.
 *    API keys need Audiobookshelf **2.26.0** or newer; before that the only
 *    credential is the login token, which expires.
 *  - **Creating a library does not scan it.** It starts a *watcher*, which
 *    notices future changes and does nothing about what is already there. The
 *    scan has to be asked for, and it is asynchronous — so the bootstrap
 *    triggers it and then waits for items rather than for the library.
 */

export const USERNAME = 'integration';
export const PASSWORD = 'integration-not-a-secret';
export const LIBRARY_NAME = 'Integration';

/** Titles in the committed fixture library. */
export const TITLES = ['Notes on the Analytical Engine', 'The Compiler'];

export interface Sandbox {
  url: string;
  libraryId: string;
  env: Record<string, string>;
}

async function json<T>(
  url: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${url}${path}`, {
    signal: AbortSignal.timeout(60_000),
    ...init,
  });
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} failed: HTTP ${response.status} — ` +
        `${(await response.text()).slice(0, 300)}`
    );
  }
  return (await response.json()) as T;
}

export async function bootstrap(
  url = `http://127.0.0.1:${process.env.AUDIOBOOKSHELF_PORT ?? '13378'}`
): Promise<Sandbox> {
  assertLoopback(url);
  await waitForHttp(`${url}/status`, {
    timeoutSeconds: 240,
    ready: (response) => response.ok,
  });

  const status = await json<{ isInit: boolean }>(url, '/status');
  if (status.isInit) {
    throw new Error(
      'This Audiobookshelf is already initialised, and the suite needs a ' +
        'fresh one: it creates a library at a fixed name and deletes what it ' +
        'made. Run `docker compose -f test/integration/compose.yml down -v` ' +
        'and up again.'
    );
  }

  // Answers the string `OK`, not JSON.
  const init = await fetch(`${url}/init`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      newRoot: { username: USERNAME, password: PASSWORD },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!init.ok) {
    throw new Error(`/init failed: HTTP ${init.status}`);
  }

  const login = await json<{
    user: { id: string; accessToken: string };
  }>(url, '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const session = login.user.accessToken;
  const userId = login.user.id;

  const library = await json<{ id: string }>(url, '/api/libraries', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: LIBRARY_NAME,
      folders: [{ fullPath: '/audiobooks' }],
      mediaType: 'book',
      provider: 'google',
    }),
  });

  const key = await json<{ apiKey: { apiKey: string } }>(url, '/api/api-keys', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session}`,
      'content-type': 'application/json',
    },
    // `userId` is required and its absence answers a bare `Bad Request`.
    body: JSON.stringify({ name: 'integration', userId, isActive: true }),
  });

  // Creating a library starts a *watcher*, not a scan. Without this the
  // library exists and stays empty for ever, which reads like the fixture
  // files being unreadable rather than like nothing having looked at them.
  const scan = await fetch(`${url}/api/libraries/${library.id}/scan`, {
    method: 'POST',
    headers: { authorization: `Bearer ${session}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!scan.ok) {
    throw new Error(`library scan could not be started: HTTP ${scan.status}`);
  }

  await waitForItems(url, key.apiKey.apiKey, library.id);

  return {
    url,
    libraryId: library.id,
    env: {
      AUDIOBOOKSHELF_URL: url,
      AUDIOBOOKSHELF_API_KEY: key.apiKey.apiKey,
      // Defaults to true in this server; the suite exists to drive the writes.
      AUDIOBOOKSHELF_READ_ONLY: 'false',
    },
  };
}

/** Waits for the scan, which starts when the library is created and takes seconds. */
async function waitForItems(
  url: string,
  apiKey: string,
  libraryId: string
): Promise<void> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    const items = await json<{ results: unknown[] }>(
      url,
      `/api/libraries/${libraryId}/items?limit=10`,
      { headers: { authorization: `Bearer ${apiKey}` } }
    );
    if (items.results.length >= TITLES.length) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `the library scan never found ${TITLES.length} items (saw ` +
          `${items.results.length}). Audiobookshelf scans the mounted ` +
          'directory asynchronously; `docker compose logs` shows what it made ' +
          'of the fixture files.'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
