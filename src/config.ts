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
  console.error(
    `audiobookshelf-mcp: ELICITATION must be "true" or "false" — got "${raw}". ` +
      'Refusing to start rather than guess.'
  );
  process.exit(1);
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

  // After the delete, deliberately: this one can exit the process, and an exit
  // above would leave the key in the environment for whatever runs next.
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
    elicitation,
    allowTools,
    denyTools,
  };
}

function isLoopbackHost(hostname: string): boolean {
  // The shared classifier, so every spelling of a loopback address is
  // recognised — including http://[::ffff:127.0.0.1] and 'localhost.' with its
  // root label, which the string comparison this replaced did not see.
  return internalHostKind(hostname) === 'loopback';
}
