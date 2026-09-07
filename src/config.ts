import { internalHostKind } from 'mcp-internal-hosts';

export interface Config {
  /**
   * Base URL of the Audiobookshelf instance, e.g. `https://abs.example.com`.
   * May be undefined together with the API key: the server still starts and
   * lists its tools, every API call then fails with {@link missingConfigMessage}.
   */
  url: string | undefined;
  apiKey: string | undefined;
  insecureTls: boolean;
  readOnly: boolean;
  /**
   * Whether a client that *can* show a dialog is asked before a guarded tool
   * acts. `ELICITATION=false` turns the dialog off — the guard stays and falls
   * back to the two-call token, so there is no setting in which a guarded call
   * goes unannounced.
   */
  elicitation: boolean;
  /**
   * Raw value of `AUDIOBOOKSHELF_ALLOW_TOOLS` — comma-separated tool names, `list_*`
   * prefixes, or `essential`. Kept unparsed on purpose: this file is a mirror of
   * the environment, and the names can only be checked against the tool
   * catalogue, which `buildToolFilter` does.
   */
  allowTools: string | undefined;
  /** Raw value of `AUDIOBOOKSHELF_DENY_TOOLS`, same shape, subtracted from the above. */
  denyTools: string | undefined;
}

/** Shown when the configuration is incomplete — at startup and on every API call. */
export function missingConfigMessage(missing: string[]): string {
  return (
    `missing required environment variable(s): ${missing.join(', ')}\n` +
    'Required: AUDIOBOOKSHELF_URL (e.g. https://abs.example.com), AUDIOBOOKSHELF_API_KEY\n' +
    'Create the API key in Audiobookshelf under Settings → Users → API Keys ' +
    '(admin only, requires server 2.26.0 or newer).\n' +
    'Optional: AUDIOBOOKSHELF_READ_ONLY=true to expose only read tools, ' +
    'AUDIOBOOKSHELF_INSECURE_TLS=true to accept self-signed certificates'
  );
}

/** Names of the required environment variables that are unset in `config`. */
export function missingConfigKeys(config: Config): string[] {
  return [
    !config.url && 'AUDIOBOOKSHELF_URL',
    !config.apiKey && 'AUDIOBOOKSHELF_API_KEY',
  ].filter((v): v is string => Boolean(v));
}

/**
 * Reads `ELICITATION` — deliberately unprefixed, and deliberately fatal on
 * anything it does not recognise.
 *
 * Unprefixed: environment variables are process-wide, so this is one switch for
 * every server in the same environment. That is also its risk, which is why a
 * server started with it off says so on its startup line.
 *
 * Fatal: this is the first variable of the family that defaults to *on*. The
 * others fail open on a typo, which is the safe direction for them. Here a typo
 * would leave the dialog running while the operator believes it is off — and an
 * operator who believes that has no way to find out.
 */
export function parseElicitation(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === '' || value === 'true') return true;
  if (value === 'false') return false;
  // Described, not quoted. ELICITATION is unprefixed and sits in the same
  // block of a compose file as AUDIOBOOKSHELF_API_KEY, so the value that lands
  // here wrong is a candidate for being the credential from the line above —
  // and this message goes to stderr, which is the MCP client's log.
  console.error(
    'audiobookshelf-mcp: ELICITATION must be "true" or "false" — got ' +
      `${describeValue(raw)}. Refusing to start rather than guess.`
  );
  process.exit(1);
}

/**
 * A configuration value named by shape and length rather than quoted.
 *
 * Every diagnostic in this file fires precisely when a variable does not hold
 * what was expected, which is exactly the state a credential pasted into the
 * wrong line produces. Only a value that already looks like one of the words
 * being asked for is safe to repeat back.
 */
function describeValue(raw: string | undefined): string {
  if (raw === undefined) return 'nothing';
  const trimmed = raw.trim();
  if (trimmed === '') return 'an empty value';
  if (/^[A-Za-z0-9_.-]{1,20}$/.test(trimmed)) return `"${trimmed}"`;
  return `a ${trimmed.length}-character value`;
}

/**
 * Shape of an Audiobookshelf API key, checked at startup.
 *
 * Not a format claim — the key is a JWT today and this server has no business
 * pinning that. It is the one property the HTTP layer requires: printable
 * ASCII, no line breaks. A key pasted with a wrapped newline inside it reaches
 * undici, whose refusal quotes the value in full, and that TypeError becomes a
 * tool result. Refusing here means the process never starts with a credential
 * it cannot send.
 */
const API_KEY_SHAPE = /^[!-~]{8,4096}$/;

/**
 * Reads the configuration from environment variables.
 *
 * Missing credentials are only a warning, not a fatal error: the server must be
 * able to complete the MCP handshake and answer `tools/list` without them, so
 * registries and sandbox inspectors can introspect it. A malformed URL still
 * exits — that one could send the API key to the wrong host.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.AUDIOBOOKSHELF_URL;
  // Trimmed before anything else: `AUDIOBOOKSHELF_API_KEY=$(cat key)` leaves a
  // trailing newline, which the Headers constructor strips and an inner one it
  // does not.
  const apiKey = env.AUDIOBOOKSHELF_API_KEY?.trim();
  const insecureTls = env.AUDIOBOOKSHELF_INSECURE_TLS === 'true';
  // Deliberately more forgiving than `AUDIOBOOKSHELF_INSECURE_TLS` above, and
  // the asymmetry is the safety argument rather than an oversight: a misspelt
  // value here fails *towards* the restriction, so `AUDIOBOOKSHELF_READ_ONLY=1`
  // in a compose file must not silently register the write tools. The
  // insecure-TLS switch fails the other way, so it keeps the exact-match rule.
  const readOnly = /^(1|true|yes)$/i.test(
    env.AUDIOBOOKSHELF_READ_ONLY?.trim() ?? ''
  );
  const allowTools = env.AUDIOBOOKSHELF_ALLOW_TOOLS;
  const denyTools = env.AUDIOBOOKSHELF_DENY_TOOLS;

  // Don't keep the key in the environment for the process lifetime — it is
  // visible to child processes and in /proc/<pid>/environ. This happens before
  // any branch on purpose: the paths below either exit or return early, and
  // "the URL is missing or malformed" is exactly the state in which someone
  // runs an inspector or trips a crash reporter, so it is the last moment the
  // key should still be sitting in the environment. Everything after this point
  // reads the locals above, never `env` again.
  delete env.AUDIOBOOKSHELF_API_KEY;

  // After the delete, deliberately: these can exit the process, and an exit
  // above would leave the key in the environment for whatever runs next.
  if (apiKey !== undefined && apiKey !== '' && !API_KEY_SHAPE.test(apiKey)) {
    // Never the value, and never the position of the offending character
    // either — the length is what tells a wrapped paste from a truncated
    // one, and that is all somebody needs to look at the right line.
    console.error(
      'audiobookshelf-mcp: AUDIOBOOKSHELF_API_KEY does not have the shape of ' +
        'an API key: it must be 8 to 4096 printable ASCII characters with no ' +
        'spaces, line breaks or control characters. The value read was ' +
        `${apiKey.length} characters long. It is not shown. Create the key ` +
        'under Settings \u2192 Users \u2192 API Keys and paste it as one line.'
    );
    process.exit(1);
  }

  const elicitation = parseElicitation(env.ELICITATION);

  const missing = [
    !url && 'AUDIOBOOKSHELF_URL',
    !apiKey && 'AUDIOBOOKSHELF_API_KEY',
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0) {
    console.error(`audiobookshelf-mcp: ${missingConfigMessage(missing)}`);
  }

  if (!url) {
    return {
      url: undefined,
      apiKey,
      insecureTls,
      readOnly,
      elicitation,
      allowTools,
      denyTools,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // The value itself is not echoed: this branch fires precisely when the
    // variable does not hold what was expected, and an API key pasted into the
    // wrong environment variable would otherwise be printed verbatim into the
    // MCP host's log.
    console.error(
      'audiobookshelf-mcp: AUDIOBOOKSHELF_URL is not a valid URL (e.g. https://abs.example.com)'
    );
    process.exit(1);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // The scheme is not printed. A 56-character hexadecimal key with a colon
    // after it is a valid URL whose scheme is the key, so this branch is one
    // of the two a pasted credential reaches — and the other one below
    // already refuses to echo.
    console.error(
      'audiobookshelf-mcp: AUDIOBOOKSHELF_URL must use http:// or https:// ' +
        `— the value read uses neither (${describeValue(parsed.protocol.replace(/:$/, ''))} ` +
        'as its scheme).'
    );
    process.exit(1);
  }
  // Credentials embedded in the URL would end up in logs and error messages.
  if (parsed.username || parsed.password) {
    console.error(
      'audiobookshelf-mcp: AUDIOBOOKSHELF_URL must not contain credentials — use AUDIOBOOKSHELF_API_KEY'
    );
    process.exit(1);
  }
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    console.error(
      'audiobookshelf-mcp: WARNING: AUDIOBOOKSHELF_URL uses plain http to a non-local host — ' +
        'the API key will be sent unencrypted. Use https:// instead.'
    );
  }

  return {
    // Built from the parsed URL, not from the raw string. `new URL()` accepts
    // more than a base URL may contain, and `fetch` then silently drops the
    // extra: `https://abs.example.com/#dev` survives validation, loses
    // everything from the `#` onwards, and every request goes to `/` — where
    // the web UI answers 200 with HTML. Before the content-type check in
    // `api.ts` that showed up as empty libraries rather than as an error.
    // A query string goes the same way, one `?` earlier.
    url: withoutTrailingSlashes(`${parsed.origin}${parsed.pathname}`),
    apiKey,
    insecureTls,
    readOnly,
    elicitation,
    allowTools,
    denyTools,
  };
}

/**
 * Drops the trailing slashes of the base URL, in one pass.
 *
 * `replace(/\/+$/, '')` looks like the obvious way and is quadratic: the
 * pattern is tried from every position of the run, and consumes the run each
 * time. An operator URL ending in eighty thousand slashes followed by one more
 * character cost 1.7 seconds at startup. Walking an index backwards and
 * slicing once is linear, and this is a base URL — the length is whatever was
 * pasted.
 */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) end--;
  return end === value.length ? value : value.slice(0, end);
}

function isLoopbackHost(hostname: string): boolean {
  // The shared classifier, so every spelling of a loopback address is
  // recognised — including http://[::ffff:127.0.0.1] and 'localhost.' with its
  // root label, which the string comparison this replaced did not see.
  return internalHostKind(hostname) === 'loopback';
}
