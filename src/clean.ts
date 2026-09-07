/**
 * What is done to text on its way out of this server.
 *
 * Every string an Audiobookshelf answer carries was written by somebody else:
 * a title or a narrator's name from the file's own tags, a description from
 * whichever metadata provider the instance queries, an episode summary from a
 * podcast feed, a collection name from whoever shares the server. All of it
 * goes into a model's context. Three things happen here, in one place, so no
 * field is the one a sweep missed:
 *
 * - **C0 and C1 control characters and DEL are removed**, except tab, line feed
 *   and carriage return. A terminal escape in a book title repaints the log of
 *   whoever reads the tool result; a NUL ends the string early for whatever
 *   parses it next. Nothing in this API means anything by them.
 * - **Lone surrogates are repaired.** `"\ud800"` is legal JSON and parses to
 *   half a character. `JSON.stringify` writes it back as an escape, so the wire
 *   stays valid — and a Python client encoding the text to UTF-8 then raises
 *   `UnicodeEncodeError: surrogates not allowed`. `toWellFormed()` replaces the
 *   half with U+FFFD, and it runs after every cut, because a cut can split a
 *   pair.
 * - **Credentials in URLs are redacted.** A podcast `feedUrl` is the one field
 *   here that routinely carries them: a private feed is published as
 *   `https://user:token@feeds.example.com/…`, Audiobookshelf stores it as
 *   given, and `get_library_item` hands it back.
 *
 * Format characters (bidi marks, joiners, zero-width) are kept. They are
 * content in a title written in Arabic, Hebrew or Hindi, and this server's
 * results are already framed as untrusted where it matters.
 *
 * The character classes are decided by code point in a loop rather than spelled
 * as a regular expression: the editing tools of this family turn a backslash-u
 * escape in a source line into the raw byte, and a raw escape character in this
 * file is exactly what the file exists to keep out of a result.
 */

function isControl(code: number): boolean {
  if (code < 0x20) return code !== 0x09 && code !== 0x0a && code !== 0x0d;
  return code >= 0x7f && code <= 0x9f;
}

/** Whether a string carries anything {@link cleanText} would remove. */
export function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (isControl(value.charCodeAt(index))) return true;
  }
  return false;
}

/**
 * Strips control characters and repairs lone surrogates.
 *
 * Linear, and cheap on the common case: a string with nothing to remove is
 * returned as it came, after a well-formedness check that costs one pass.
 */
export function cleanText(value: string): string {
  let out: string | undefined;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (isControl(value.charCodeAt(index))) {
      out = (out ?? '') + value.slice(start, index);
      start = index + 1;
    }
  }
  const stripped = out === undefined ? value : out + value.slice(start);
  return stripped.isWellFormed() ? stripped : stripped.toWellFormed();
}

/**
 * Removes credentials from a URL.
 *
 * The pattern stops at the *last* `@` before the path — `[^/?#]*@` — so
 * `https://a@b@host/` loses both, and a path or query that merely contains an
 * `@` is left alone.
 */
export function redactUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1***@');
}

/**
 * Whether a string is URL-shaped enough that {@link redactUrl} should see it.
 *
 * Deliberately narrow: only a value that begins with a scheme and `//`, which
 * is what a `feedUrl`, an `imageUrl` or an enclosure address looks like. A
 * description that merely mentions an address is prose and stays as written.
 */
function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

/**
 * {@link cleanText} over a whole structure, with URL redaction on the way.
 *
 * Rebuilds every object with `Object.fromEntries`, so a key of `__proto__` —
 * an own property after `JSON.parse`, and legal JSON from any backend — stays
 * an own property of the copy instead of becoming its prototype. Keys are
 * cleaned as well as values: a key is text a model reads too.
 *
 * Numbers, booleans and null pass through. `undefined` and functions cannot
 * come out of JSON; they are dropped from objects, where `JSON.stringify`
 * would drop them anyway, and written as `null` in arrays, which is also what
 * it would do — so the two channels cannot disagree about them.
 */
export function cleanValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const clean = cleanText(value);
    return looksLikeUrl(clean) ? redactUrl(clean) : clean;
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      entry === undefined || typeof entry === 'function'
        ? null
        : cleanValue(entry)
    );
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(
        ([key, entry]) =>
          entry === undefined || typeof entry === 'function'
            ? []
            : [[cleanText(key), cleanValue(entry)]]
      )
    );
  }
  return value;
}

/** How much of an upstream error body may be quoted back. */
const MAX_UPSTREAM_TEXT = 2000;

/**
 * Text written by whatever answered a request, made safe to quote.
 *
 * Audiobookshelf's error bodies are short and worth reading — "Invalid
 * playlist items. Length mismatch" is the whole diagnosis. But the thing that
 * answers is not always Audiobookshelf: a reverse proxy, an SSO portal or an
 * outbound filter writes its own body, and under `AUDIOBOOKSHELF_INSECURE_TLS`
 * so can anything that can reach the address. So the text is stripped, cut and
 * labelled as what it is.
 */
export function upstreamText(text: string, max = MAX_UPSTREAM_TEXT): string {
  const trimmed = cleanText(text).trim();
  if (trimmed.length === 0) return '';
  // Anything markup-shaped: a reverse proxy's error page or a WAF block page.
  // The check is deliberately loose — an XML declaration, a leading comment or
  // a doctype followed by a newline are all the same thing here.
  if (/^(<!doctype|<html[\s>]|<\?xml|<!--)/i.test(trimmed)) {
    return '(HTML error page omitted)';
  }
  const cut =
    trimmed.length > max
      ? `${trimmed.slice(0, max).toWellFormed()}… (truncated)`
      : trimmed;
  return `(untrusted text from the instance): ${cut}`;
}

/**
 * A value shortened for a sentence.
 *
 * For the messages that have to name what was rejected — a media type that is
 * not "book", a content type that is not JSON — without letting a hundred
 * kilobytes of the instance's choosing into the model's context.
 */
export function quoted(value: string, max = 80): string {
  const clean = cleanText(value);
  return clean.length > max
    ? `${clean.slice(0, max).toWellFormed()}… (${clean.length - max} more characters)`
    : clean;
}

/**
 * Refuses a header value the HTTP layer would refuse, without quoting it.
 *
 * undici's own refusal is `Headers.append: "<value>" is an invalid header
 * value.` — the whole value, in a `TypeError` that this server turns into a
 * tool result. The one header this server builds from a secret is
 * `Authorization`, so an API key with a line break in the middle of it — a
 * wrapped paste — would arrive in the model's context by way of an error
 * message. Refusing first means the runtime never gets to quote one.
 *
 * The message names the header and where the offending character sits, which
 * is what someone fixing a pasted credential needs, and nothing else.
 */
export function assertHeaderValue(name: string, value: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    // Visible ASCII, plus space and tab, is what a header value may hold.
    if (code === 0x09 || (code >= 0x20 && code <= 0x7e)) continue;
    throw new Error(
      `the ${name} header cannot be sent: the value holds a character that is ` +
        `not allowed in an HTTP header at position ${index} of ${value.length}. ` +
        'For Authorization this is the API key — check ' +
        'AUDIOBOOKSHELF_API_KEY for a line break or a stray character from ' +
        'the paste. The value itself is not shown.'
    );
  }
}

/**
 * Field names whose value is a credential, matched on the normalised suffix.
 *
 * Suffix rather than exact match: Audiobookshelf's user object calls the
 * password hash `pash` and the access token `token`, but a backend is free to
 * answer `git-password` or `oauth_client_secret` in any pass-through record,
 * and an exact list has to be right about spellings nobody controls. `key` is
 * deliberately absent — it would take every `*_key` identifier with it.
 */
const CREDENTIAL_SUFFIXES = [
  'password',
  'passwd',
  'passphrase',
  'pash',
  'secret',
  'token',
  'apikey',
  'privatekey',
] as const;

/** Whether a field of this name holds a credential. */
export function isCredentialKey(key: string): boolean {
  const normalised = key.toLowerCase().replaceAll(/[_-]/g, '');
  return CREDENTIAL_SUFFIXES.some((suffix) => normalised.endsWith(suffix));
}

/** What {@link redactCredentials} put in place of a value, and where. */
export interface RedactionReport {
  /** Dotted paths of the fields that were replaced, in encounter order. */
  readonly removed: string[];
}

const REDACTED = '(removed by audiobookshelf-mcp: this field is a credential)';

/**
 * Replaces credential-shaped fields anywhere in a record the API returned.
 *
 * The reason this exists at all is `GET /api/me`. It answers with
 * `User.toOldJSONForBrowser()`, and `MeController.getCurrentUser` calls it
 * without `hideRootToken` — so the document carries `token`, the account's old
 * non-expiring access token, for the root user included. `detail: "full"`
 * hands the raw record on, which put a credential that outlives this process
 * into a model's context and into whatever that model's operator logs.
 *
 * Written as a walk over every pass-through record rather than as a `delete`
 * on that one field: the projection is not the API, and the next release of
 * either is free to add a second one.
 */
export function redactCredentials(
  value: unknown,
  report: RedactionReport = { removed: [] },
  path = ''
): { value: unknown; report: RedactionReport } {
  if (Array.isArray(value)) {
    const items = value.map(
      (entry, index) =>
        redactCredentials(entry, report, `${path}[${index}]`).value
    );
    return { value: items, report };
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, entry]): [string, unknown] => {
        const here = path === '' ? key : `${path}.${key}`;
        if (isCredentialKey(key)) {
          report.removed.push(here);
          return [key, REDACTED];
        }
        return [key, redactCredentials(entry, report, here).value];
      }
    );
    return { value: Object.fromEntries(entries), report };
  }
  return { value, report };
}
