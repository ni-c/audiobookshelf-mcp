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
    console.error(
      `audiobookshelf-mcp: AUDIOBOOKSHELF_URL is not a valid URL: ${url}`
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

  const config: Config = {
    url: url.replace(/\/+$/, ''),
    apiKey,
    insecureTls,
    readOnly,
  };

  // Don't keep the key in the environment for the process lifetime — it is
  // visible to child processes and in /proc/<pid>/environ.
  delete env.AUDIOBOOKSHELF_API_KEY;

  return config;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.startsWith('127.') ||
    hostname === '::1'
  );
}
