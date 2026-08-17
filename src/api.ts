import {
  Agent,
  fetch as undiciFetch,
  type RequestInit as UndiciRequestInit,
} from 'undici';

import {
  missingConfigKeys,
  missingConfigMessage,
  type Config,
} from './config.js';

const REQUEST_TIMEOUT_MS = 15_000;

export class AudiobookshelfApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    method: string,
    path: string
  ) {
    super(`Audiobookshelf API ${method} ${path} failed with HTTP ${status}`);
    this.name = 'AudiobookshelfApiError';
  }
}

/** Minimal client for the Audiobookshelf REST API. */
export class AudiobookshelfApi {
  private readonly config: Config;
  private readonly baseUrl: string;
  /**
   * Only set when AUDIOBOOKSHELF_INSECURE_TLS is enabled. Scopes the relaxed
   * certificate validation to requests against the configured host instead of
   * disabling it process-wide via NODE_TLS_REJECT_UNAUTHORIZED.
   */
  private readonly insecureDispatcher?: Agent;

  constructor(config: Config) {
    this.config = config;
    this.baseUrl = config.url ?? '';
    if (config.insecureTls) {
      this.insecureDispatcher = new Agent({
        connect: { rejectUnauthorized: false },
      });
    }
  }

  async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> {
    // The credentials are only required here, not at startup, so the server can
    // still be started and introspected without them.
    const missing = missingConfigKeys(this.config);
    if (missing.length > 0) {
      throw new Error(missingConfigMessage(missing));
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey ?? ''}`,
      Accept: 'application/json',
    };
    const init: RequestInit = {
      method,
      headers,
      // Never follow a redirect: it would resend the Authorization header to
      // whatever host the upstream points at.
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const url = `${this.baseUrl}${path}`;
    // The insecure dispatcher requires undici's own fetch; the default path uses
    // the (stubbable) global fetch so tests can intercept it.
    const response = this.insecureDispatcher
      ? await undiciFetch(url, {
          ...init,
          dispatcher: this.insecureDispatcher,
        } as UndiciRequestInit)
      : await fetch(url, init);
    const text = await response.text();

    if (!response.ok) {
      throw new AudiobookshelfApiError(response.status, text, method, path);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return text;
  }

  get(path: string): Promise<unknown> {
    return this.request('GET', path);
  }

  post(path: string, body?: unknown): Promise<unknown> {
    return this.request('POST', path, body);
  }

  patch(path: string, body?: unknown): Promise<unknown> {
    return this.request('PATCH', path, body);
  }

  delete(path: string): Promise<unknown> {
    return this.request('DELETE', path);
  }
}

/**
 * Guards an id that ends up in a URL path. Path traversal here would let a
 * caller reach a different resource — or a different API entirely.
 *
 * Audiobookshelf ids are UUIDs on current servers and prefixed slugs
 * (`li_…`, `lib_…`, `col_…`, `pl_…`, `aut_…`) on older ones; both fit.
 */
export function assertPathSegment(value: string, what: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error(
      `invalid ${what}: only letters, digits, dot, underscore and hyphen are allowed`
    );
  }
  return value;
}

/**
 * Builds a query string from defined values only.
 *
 * URLSearchParams does the percent-encoding, which matters for the `filter`
 * parameter: its base64 payload can contain `+`, `/` and `=`.
 */
export function query(
  params: Record<string, string | number | boolean | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(
      key,
      typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
    );
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}
