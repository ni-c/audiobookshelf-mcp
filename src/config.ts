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
 * Reads the configuration from environment variables.
 *
 * Missing credentials are only a warning, not a fatal error: the server must be
 * able to complete the MCP handshake and answer `tools/list` without them, so
 * registries and sandbox inspectors can introspect it. A malformed URL still
 * exits — that one could send the API key to the wrong host.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.AUDIOBOOKSHELF_URL;
  const apiKey = env.AUDIOBOOKSHELF_API_KEY;
  const insecureTls = env.AUDIOBOOKSHELF_INSECURE_TLS === 'true';
  const readOnly = env.AUDIOBOOKSHELF_READ_ONLY === 'true';

  // Don't keep the key in the environment for the process lifetime — it is
  // visible to child processes and in /proc/<pid>/environ. This happens before
  // any branch on purpose: the paths below either exit or return early, and
  // "the URL is missing or malformed" is exactly the state in which someone
  // runs an inspector or trips a crash reporter, so it is the last moment the
  // key should still be sitting in the environment. Everything after this point
  // reads the locals above, never `env` again.
  delete env.AUDIOBOOKSHELF_API_KEY;

  const missing = [
    !url && 'AUDIOBOOKSHELF_URL',
    !apiKey && 'AUDIOBOOKSHELF_API_KEY',
  ].filter((v): v is string => Boolean(v));

  if (missing.length > 0) {
    console.error(`audiobookshelf-mcp: ${missingConfigMessage(missing)}`);
  }

  if (!url) {
    return { url: undefined, apiKey, insecureTls, readOnly };
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
    console.error(
      `audiobookshelf-mcp: AUDIOBOOKSHELF_URL must use http:// or https:// (got ${parsed.protocol})`
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
    url: url.replace(/\/+$/, ''),
    apiKey,
    insecureTls,
    readOnly,
  };
}

function isLoopbackHost(hostname: string): boolean {
  // URL.hostname keeps the brackets around an IPv6 literal, so comparing against
  // a bare '::1' never matches and the plain-http warning fires on a loopback
  // URL written as http://[::1]:13378.
  const host = hostname.replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.startsWith('127.') ||
    host === '::1'
  );
}
