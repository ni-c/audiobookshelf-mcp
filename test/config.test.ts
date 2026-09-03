import { describe, expect, it, vi } from 'vitest';

import { loadConfig, missingConfigKeys } from '../src/config.js';

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return { ...values } as NodeJS.ProcessEnv;
}

describe('ELICITATION', () => {
  const base = {
    AUDIOBOOKSHELF_URL: 'https://abs.example.com',
    AUDIOBOOKSHELF_API_KEY: 'secret',
  };

  it('defaults to on, and to on for an empty value', () => {
    // The only variable of this family that defaults to *on*. An unset switch
    // has to mean "ask", or a deployment that never heard of it would quietly
    // stop asking.
    expect(loadConfig(env(base)).elicitation).toBe(true);
    expect(loadConfig(env({ ...base, ELICITATION: '' })).elicitation).toBe(
      true
    );
  });

  it('is switched off by "false", in any casing or padding', () => {
    for (const raw of ['false', 'FALSE', ' False ']) {
      expect(
        loadConfig(env({ ...base, ELICITATION: raw })).elicitation,
        raw
      ).toBe(false);
    }
  });

  it('refuses to start on anything else, naming both valid values', () => {
    for (const raw of ['1', 'off', 'no']) {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit');
      }) as never);
      expect(() => loadConfig(env({ ...base, ELICITATION: raw }))).toThrow(
        'exit'
      );
      expect(exit).toHaveBeenCalledWith(1);
      const message = String(error.mock.calls[0]?.[0] ?? '');
      expect(message, raw).toContain('ELICITATION');
      expect(message, raw).toContain('"true"');
      expect(message, raw).toContain('"false"');
      vi.restoreAllMocks();
    }
  });

  it('has already wiped the API key by the time it can exit', () => {
    // parseElicitation sits *after* the delete on purpose. An exit above it
    // would leave the key in the environment for whatever a crash reporter or
    // an inspector does next — which is exactly what that delete exists to
    // prevent, and its comment says so.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const e = env({ ...base, ELICITATION: 'nonsense' });
    expect(() => loadConfig(e)).toThrow('exit');
    expect(e.AUDIOBOOKSHELF_API_KEY).toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe('loadConfig', () => {
  it('starts without credentials so tools stay listable', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = loadConfig(env({}));
    expect(config.url).toBeUndefined();
    expect(missingConfigKeys(config)).toEqual([
      'AUDIOBOOKSHELF_URL',
      'AUDIOBOOKSHELF_API_KEY',
    ]);
    spy.mockRestore();
  });

  it('deletes the API key from the environment after reading it', () => {
    const e = env({
      AUDIOBOOKSHELF_URL: 'https://abs.example.com',
      AUDIOBOOKSHELF_API_KEY: 'secret',
    });
    const config = loadConfig(e);
    expect(config.apiKey).toBe('secret');
    expect(e.AUDIOBOOKSHELF_API_KEY).toBeUndefined();
  });

  it('deletes the API key even when the URL is missing', () => {
    // Regression: with the delete at the end of loadConfig, the early return for
    // a missing URL skipped it, and the key stayed in the environment for the
    // whole process lifetime — readable in /proc/<pid>/environ and inherited by
    // any child process. A missing URL with a key present is a plausible
    // misconfiguration, and it is exactly the state in which someone reaches for
    // an inspector.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = env({ AUDIOBOOKSHELF_API_KEY: 'secret' });
    const config = loadConfig(e);
    expect(e.AUDIOBOOKSHELF_API_KEY).toBeUndefined();
    // Still handed to the caller — the server starts, it just cannot call out.
    expect(config.apiKey).toBe('secret');
    expect(config.url).toBeUndefined();
    spy.mockRestore();
  });

  it('strips trailing slashes from the base URL', () => {
    const config = loadConfig(
      env({
        AUDIOBOOKSHELF_URL: 'https://abs.example.com//',
        AUDIOBOOKSHELF_API_KEY: 'k',
      })
    );
    expect(config.url).toBe('https://abs.example.com');
  });

  it.each([
    ['https://abs.example.com/#dev', 'https://abs.example.com'],
    ['https://abs.example.com/?token=x', 'https://abs.example.com'],
    ['https://abs.example.com/abs/', 'https://abs.example.com/abs'],
  ])('builds the base URL from %j as %j', (raw, expected) => {
    // The base URL used to be the raw string with trailing slashes stripped.
    // `new URL()` accepts a fragment and a query, so both survived validation —
    // and `fetch` then silently drops everything from the `#` or the `?`
    // onwards, sending every request to `/` with the bearer token attached.
    // Audiobookshelf's web UI answers that with 200 and HTML, and before the
    // content-type check in api.ts the tools reported empty libraries.
    const config = loadConfig(
      env({ AUDIOBOOKSHELF_URL: raw, AUDIOBOOKSHELF_API_KEY: 'k' })
    );
    expect(config.url).toBe(expected);
  });

  it.each(['true', 'TRUE', ' true ', '1', 'yes', 'Yes'])(
    'reads AUDIOBOOKSHELF_READ_ONLY=%j as on',
    (value) => {
      // Read-only fails *towards* the restriction, so every spelling an
      // operator plausibly writes into a compose file has to close it.
      const config = loadConfig(
        env({
          AUDIOBOOKSHELF_URL: 'https://abs.example.com',
          AUDIOBOOKSHELF_API_KEY: 'k',
          AUDIOBOOKSHELF_READ_ONLY: value,
        })
      );
      expect(config.readOnly).toBe(true);
    }
  );

  it.each(['false', '', 'no', '0', 'off'])(
    'reads AUDIOBOOKSHELF_READ_ONLY=%j as off',
    (value) => {
      const config = loadConfig(
        env({
          AUDIOBOOKSHELF_URL: 'https://abs.example.com',
          AUDIOBOOKSHELF_API_KEY: 'k',
          AUDIOBOOKSHELF_READ_ONLY: value,
        })
      );
      expect(config.readOnly).toBe(false);
    }
  );

  it.each(['1', 'yes', 'TRUE', ' true '])(
    'leaves AUDIOBOOKSHELF_INSECURE_TLS off for %j',
    (value) => {
      // The opposite direction, deliberately: a typo here would relax
      // certificate validation, so only the exact string counts.
      const config = loadConfig(
        env({
          AUDIOBOOKSHELF_URL: 'https://abs.example.com',
          AUDIOBOOKSHELF_API_KEY: 'k',
          AUDIOBOOKSHELF_INSECURE_TLS: value,
        })
      );
      expect(config.insecureTls).toBe(false);
    }
  );

  it('rejects a URL containing credentials', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    expect(() =>
      loadConfig(
        env({
          AUDIOBOOKSHELF_URL: 'https://user:pw@abs.example.com',
          AUDIOBOOKSHELF_API_KEY: 'k',
        })
      )
    ).toThrow('exit');
    exit.mockRestore();
    spy.mockRestore();
  });

  it('rejects a non-http protocol', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    expect(() =>
      loadConfig(
        env({
          AUDIOBOOKSHELF_URL: 'file:///etc/passwd',
          AUDIOBOOKSHELF_API_KEY: 'k',
        })
      )
    ).toThrow('exit');
    exit.mockRestore();
    spy.mockRestore();
  });

  it('warns about plain http to a remote host but keeps going', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config = loadConfig(
      env({
        AUDIOBOOKSHELF_URL: 'http://abs.example.com',
        AUDIOBOOKSHELF_API_KEY: 'k',
      })
    );
    expect(config.url).toBe('http://abs.example.com');
    expect(spy.mock.calls.flat().join(' ')).toMatch(/unencrypted/);
    spy.mockRestore();
  });

  it('does not warn about plain http to localhost', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadConfig(
      env({
        AUDIOBOOKSHELF_URL: 'http://localhost:13378',
        AUDIOBOOKSHELF_API_KEY: 'k',
      })
    );
    expect(spy.mock.calls.flat().join(' ')).not.toMatch(/unencrypted/);
    spy.mockRestore();
  });

  it('does not warn about plain http to loopback in any notation', () => {
    // Regression: URL.hostname returns "[::1]" with the brackets, so comparing
    // against a bare "::1" never matched and this warned about a loopback URL.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const url of [
      'http://[::1]:13378',
      'http://127.0.0.1:13378',
      'http://abs.localhost:13378',
    ]) {
      loadConfig(env({ AUDIOBOOKSHELF_URL: url, AUDIOBOOKSHELF_API_KEY: 'k' }));
      expect(spy.mock.calls.flat().join(' '), url).not.toMatch(/unencrypted/);
    }
    spy.mockRestore();
  });

  it('reads the read-only and insecure-TLS switches', () => {
    const config = loadConfig(
      env({
        AUDIOBOOKSHELF_URL: 'https://abs.example.com',
        AUDIOBOOKSHELF_API_KEY: 'k',
        AUDIOBOOKSHELF_READ_ONLY: 'true',
        AUDIOBOOKSHELF_INSECURE_TLS: 'true',
      })
    );
    expect(config.readOnly).toBe(true);
    expect(config.insecureTls).toBe(true);
  });
});

describe('loadConfig URL validation', () => {
  it('exits on a URL that cannot be parsed at all', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    expect(() =>
      loadConfig(
        env({
          AUDIOBOOKSHELF_URL: 'not a url at all',
          AUDIOBOOKSHELF_API_KEY: 'k',
        })
      )
    ).toThrow('exit');
    expect(logged.mock.calls.flat().join(' ')).toMatch(/is not a valid URL/);

    exit.mockRestore();
    logged.mockRestore();
  });

  it('does not echo the offending value', () => {
    // Regression: this branch fires precisely when the variable does not hold a
    // URL — most often because the API key was pasted into the wrong one. The
    // message used to quote the value, putting the key in the MCP host's log.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    expect(() =>
      loadConfig(
        env({
          AUDIOBOOKSHELF_URL: 'abs_secret_pasted_into_the_wrong_variable',
          AUDIOBOOKSHELF_API_KEY: 'k',
        })
      )
    ).toThrow('exit');
    const output = logged.mock.calls.flat().join(' ');
    expect(output).toMatch(/is not a valid URL/);
    expect(output).not.toContain('abs_secret_pasted_into_the_wrong_variable');

    exit.mockRestore();
    logged.mockRestore();
  });
});

describe('missingConfigKeys', () => {
  it('names exactly the variables that are unset', () => {
    const base = {
      insecureTls: false,
      readOnly: false,
      elicitation: true,
      allowTools: undefined,
      denyTools: undefined,
    };
    expect(
      missingConfigKeys({ ...base, url: undefined, apiKey: undefined })
    ).toEqual(['AUDIOBOOKSHELF_URL', 'AUDIOBOOKSHELF_API_KEY']);
    expect(
      missingConfigKeys({ ...base, url: 'https://a.example.com', apiKey: '' })
    ).toEqual(['AUDIOBOOKSHELF_API_KEY']);
    expect(
      missingConfigKeys({ ...base, url: 'https://a.example.com', apiKey: 'k' })
    ).toEqual([]);
  });
});
