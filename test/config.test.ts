import { describe, expect, it, vi } from 'vitest';

import { loadConfig, missingConfigKeys } from '../src/config.js';

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return { ...values } as NodeJS.ProcessEnv;
}

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
    const base = { insecureTls: false, readOnly: false };
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
