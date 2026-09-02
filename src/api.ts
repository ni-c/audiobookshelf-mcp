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

/**
 * Ceiling on a single upstream response.
 *
 * Not a theoretical number. `/api/collections` has no pagination at all, and a
 * collection carries every one of its books expanded — a shared server with
 * forty collections of three hundred books answers in double-digit megabytes,
 * and `response.text()` followed by `JSON.parse` holds roughly three copies of
 * that at once. The documented 95 kB of `/api/me/listening-stats` is the
 * harmless end of the same range.
 */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

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

/** Thrown when a response is larger than this server is willing to read. */
export class ResponseTooLargeError extends Error {
  constructor(path: string, limit: number) {
    super(
      `the Audiobookshelf response for ${path} exceeds the ` +
        `${Math.round(limit / 1024 / 1024)} MB ceiling and was not read. ` +
        'Narrow the request — most listing tools take limit and page, and ' +
        'library_id restricts a server-wide listing to one library.'
    );
    this.name = 'ResponseTooLargeError';
  }
}

/**
 * Thrown when a 200 carries something other than JSON.
 *
 * Returning the body instead would send an HTML login page into `listFrom`,
 * which finds neither an array nor an envelope and answers `[]` — so
 * `list_libraries` reports "you have no libraries" where the truth is that an
 * SSO portal or a misconfigured reverse proxy answered instead of the API. A
 * swallowed error replaced by a plausible wrong answer is worse than an error.
 */
export class UnexpectedContentTypeError extends Error {
  constructor(path: string, contentType: string) {
    super(
      `Audiobookshelf answered ${path} with "${contentType || 'no content type'}" ` +
        'instead of JSON. A 200 that is not JSON usually means something in ' +
        'front of the instance answered instead of the API — an SSO portal, a ' +
        'captive proxy or a login page. Check AUDIOBOOKSHELF_URL.'
    );
    this.name = 'UnexpectedContentTypeError';
  }
}

/**
 * Reads a response body with a hard byte ceiling.
 *
 * Both halves matter: `content-length` catches an oversized answer before a
 * single byte is read, and the streaming count catches a chunked response,
 * which declares no length at all.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
  allowTruncation: boolean
): Promise<{ text: string; truncated: boolean }> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes && !allowTruncation) {
    // Nothing has been read yet, so the body can simply be discarded.
    await response.body?.cancel();
    return { text: '', truncated: true };
  }

  const body = response.body;
  if (!body) return { text: '', truncated: false };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    if (total + value.byteLength > maxBytes) {
      // `maxBytes - total` is exactly the remaining budget, and the `>` above
      // makes an exactly-maxBytes response legal rather than truncated.
      chunks.push(value.subarray(0, maxBytes - total));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }

  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}

export interface RequestOptions {
  /**
   * Accept a body that is not JSON.
   *
   * Only for the five routes that are known to answer `200 text/plain "OK"`
   * rather than a document — verified against 2.29.0:
   * `DELETE /api/collections/{id}`, `DELETE /api/playlists/{id}`,
   * `PATCH /api/me/progress/{id}`, `DELETE /api/me/progress/{id}` and
   * `DELETE /api/me/item/{id}/bookmark/{time}`. Every one of them is a mutation
   * whose caller ignores the value, so the honest thing is to say so at the
   * call site rather than to weaken the check for everything.
   */
  text?: boolean;
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
    body?: unknown,
    options: RequestOptions = {}
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

    // An error body is only ever quoted back after `sanitizeErrorBody` cuts it
    // to 2 000 characters, so truncating it costs nothing and keeps the status
    // code — which is the diagnostic — instead of replacing it with a size
    // complaint. A successful body cannot be truncated: half a JSON document is
    // not a smaller answer.
    const { text, truncated } = await readCapped(
      response as unknown as Response,
      MAX_RESPONSE_BYTES,
      !response.ok
    );

    if (!response.ok) {
      throw new AudiobookshelfApiError(response.status, text, method, path);
    }
    if (truncated) {
      throw new ResponseTooLargeError(path, MAX_RESPONSE_BYTES);
    }

    // A body-less success. Several routes answer 200 or 204 with nothing at
    // all, and "nothing" has no content type to check.
    if (text.length === 0) return undefined;
    // A route that is known to answer text. Its caller ignores the value.
    if (options.text) return text;

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new UnexpectedContentTypeError(path, contentType);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new UnexpectedContentTypeError(
        path,
        `${contentType} (unparseable)`
      );
    }
  }

  get(path: string, options?: RequestOptions): Promise<unknown> {
    return this.request('GET', path, undefined, options);
  }

  post(
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<unknown> {
    return this.request('POST', path, body, options);
  }

  patch(
    path: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<unknown> {
    return this.request('PATCH', path, body, options);
  }

  delete(path: string, options?: RequestOptions): Promise<unknown> {
    return this.request('DELETE', path, undefined, options);
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
