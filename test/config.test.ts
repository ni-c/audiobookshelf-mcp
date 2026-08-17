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
