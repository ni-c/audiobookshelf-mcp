import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  assertHeaderValue,
  cleanText,
  cleanValue,
  hasControl,
  isCredentialKey,
  quoted,
  redactCredentials,
  redactUrl,
  upstreamText,
} from '../src/clean.js';

/**
 * Control characters are built from code points at runtime rather than spelled
 * as escapes. The editing tools of this family turn a backslash-u escape in a
 * source line into the raw byte, and a raw escape in a test file is the thing
 * the module under test exists to remove.
 */
const ESC = String.fromCharCode(0x1b);
const NUL = String.fromCharCode(0);
const DEL = String.fromCharCode(0x7f);
const LONE_SURROGATE = String.fromCharCode(0xd800);

describe('cleanText', () => {
  it('removes C0, C1 and DEL but keeps tab, newline and carriage return', () => {
    const text = `a${ESC}[31mb${NUL}c${DEL}d\te\nf\rg`;
    expect(cleanText(text)).toBe('a[31mbcd\te\nf\rg');
  });

  it('keeps format characters, which are content in a title', () => {
    // A right-to-left mark in an Arabic or Hebrew title is part of the title.
    // Stripping it would change what the book is called.
    const rlm = String.fromCodePoint(0x200f);
    const zwj = String.fromCodePoint(0x200d);
    expect(cleanText(`x${rlm}y${zwj}z`)).toBe(`x${rlm}y${zwj}z`);
  });

  it('repairs a lone surrogate', () => {
    // Legal JSON, half a character. A Python client encoding the result to
    // UTF-8 raises UnicodeEncodeError on it.
    const cleaned = cleanText(`a${LONE_SURROGATE}b`);
    expect(cleaned.isWellFormed()).toBe(true);
    expect(cleaned).not.toContain(LONE_SURROGATE);
  });

  it('returns a clean string unchanged, by identity', () => {
    const text = 'An ordinary book title';
    expect(cleanText(text)).toBe(text);
  });

  it('agrees with hasControl about what it would remove', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (text) => {
        expect(cleanText(text) === text || hasControl(text)).toBe(true);
      }),
      { numRuns: 300 }
    );
  });

  it('never leaves a control character behind, for any input', () => {
    fc.assert(
      fc.property(
        fc.string({
          maxLength: 80,
          unit: fc.constantFrom(
            'a',
            ESC,
            NUL,
            DEL,
            LONE_SURROGATE,
            String.fromCharCode(0x9b),
            '\t',
            '\n'
          ),
        }),
        (text) => {
          const cleaned = cleanText(text);
          expect(hasControl(cleaned.replaceAll(/[\t\n\r]/g, ''))).toBe(false);
          expect(cleaned.isWellFormed()).toBe(true);
        }
      ),
      { numRuns: 400 }
    );
  });
});

describe('redactUrl', () => {
  it('removes credentials from a URL', () => {
    expect(redactUrl('https://user:s3cret@feeds.example.com/f.rss')).toBe(
      'https://***@feeds.example.com/f.rss'
    );
  });

  it('stops at the last @ before the path', () => {
    expect(redactUrl('https://a@b:c@host/x')).toBe('https://***@host/x');
  });

  it('leaves an @ in the path alone', () => {
    const url = 'https://feeds.example.com/user@example.com/f.rss';
    expect(redactUrl(url)).toBe(url);
  });
});

describe('cleanValue', () => {
  it('redacts a podcast feed URL carrying its credentials', () => {
    // A private podcast feed is published exactly like this, Audiobookshelf
    // stores it as given, and get_library_item hands it back.
    const value = cleanValue({
      feedUrl: 'https://sub:t0ken@feeds.example.com/private.rss',
    }) as { feedUrl: string };
    expect(value.feedUrl).toBe('https://***@feeds.example.com/private.rss');
  });

  it('leaves prose that merely mentions an address alone', () => {
    const value = cleanValue({
      description: 'Write to us at post@example.com about the show',
    }) as { description: string };
    expect(value.description).toContain('post@example.com');
  });

  it('keeps a __proto__ key as an own property', () => {
    // An own property after JSON.parse, and legal JSON from any backend. A
    // walker that rebuilds objects with `out[key] = …` loses it silently.
    const parsed = JSON.parse(
      '{"__proto__": {"polluted": true}, "a": 1}'
    ) as Record<string, unknown>;
    const cleaned = cleanValue(parsed) as Record<string, unknown>;
    expect(Object.hasOwn(cleaned, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(cleaned)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('cleans keys as well as values', () => {
    const cleaned = cleanValue({ [`ti${ESC}tle`]: `a${ESC}b` }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(cleaned)).toEqual(['title']);
    expect(cleaned.title).toBe('ab');
  });

  it('writes an undefined array entry as null, like JSON.stringify would', () => {
    expect(cleanValue([undefined, 1])).toEqual([null, 1]);
  });
});

describe('upstreamText', () => {
  it('labels the instance’s words and strips control characters', () => {
    const text = upstreamText(`bad${ESC}[2J request`);
    expect(text).toContain('untrusted text from the instance');
    expect(text).not.toContain(ESC);
  });

  it('drops an HTML error page whole', () => {
    expect(upstreamText('<!DOCTYPE html><html>x</html>')).toBe(
      '(HTML error page omitted)'
    );
  });

  it('is empty for an empty body, rather than a label with nothing after it', () => {
    expect(upstreamText('   ')).toBe('');
  });

  it('cuts a long body and says so', () => {
    const text = upstreamText('e'.repeat(5000));
    expect(text).toContain('… (truncated)');
    expect(text.length).toBeLessThan(2200);
  });
});

describe('quoted', () => {
  it('cuts a long value and counts what it left out', () => {
    expect(quoted('x'.repeat(500))).toMatch(/… \(420 more characters\)$/);
  });

  it('strips control characters from a short one', () => {
    expect(quoted(`a${ESC}b`)).toBe('ab');
  });
});

describe('assertHeaderValue', () => {
  it('accepts an ordinary bearer value', () => {
    expect(() =>
      assertHeaderValue('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.abc')
    ).not.toThrow();
  });

  it('refuses a value with a line break without quoting it', () => {
    // undici's own refusal repeats the whole value, and for this server that
    // value is the API key. The refusal here must say where the problem is and
    // nothing more.
    const key = `eyJhbGciOi\nSECRET-PART-OF-THE-TOKEN`;
    let message = '';
    try {
      assertHeaderValue('Authorization', `Bearer ${key}`);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('Authorization');
    expect(message).toContain('AUDIOBOOKSHELF_API_KEY');
    expect(message).not.toContain('SECRET-PART-OF-THE-TOKEN');
    expect(message).not.toContain('eyJhbGciOi');
  });

  it('refuses any character outside the printable range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0x10ffff }).filter((code) => {
          if (code === 0x09) return false;
          return code < 0x20 || code > 0x7e;
        }),
        (code) => {
          expect(() =>
            assertHeaderValue(
              'Authorization',
              `a${String.fromCodePoint(code)}b`
            )
          ).toThrow();
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('redactCredentials', () => {
  it('removes the access token GET /api/me answers with', () => {
    // `User.toOldJSONForBrowser()` carries `token`, the account's old
    // non-expiring access token, and `MeController.getCurrentUser` calls it
    // without `hideRootToken` — so a root account's token is in there too.
    const { value, report } = redactCredentials({
      id: 'u1',
      username: 'willi',
      token: 'eyJhbGciOiJIUzI1NiJ9.THE-ACCESS-TOKEN.sig',
      permissions: { upload: false },
    });
    expect(JSON.stringify(value)).not.toContain('THE-ACCESS-TOKEN');
    expect(report.removed).toEqual(['token']);
    expect((value as { username: string }).username).toBe('willi');
  });

  it('reaches a credential nested in a list', () => {
    const { value, report } = redactCredentials({
      sessions: [{ id: 's1', refresh_token: 'SECRET-REFRESH' }],
    });
    expect(JSON.stringify(value)).not.toContain('SECRET-REFRESH');
    expect(report.removed).toEqual(['sessions[0].refresh_token']);
  });

  it('matches on the suffix, so a spelling nobody chose is still caught', () => {
    for (const key of [
      'token',
      'apiKey',
      'api_key',
      'git-password',
      'oauth_client_secret',
      'pash',
      'PrivateKey',
    ]) {
      expect(isCredentialKey(key), key).toBe(true);
    }
  });

  it('leaves identifiers and neighbours alone', () => {
    // `key` on its own is deliberately not in the suffix list: it would take
    // every `*_key` identifier with it.
    for (const key of [
      'id',
      'libraryId',
      'ssh_key',
      'sort_key',
      'tokens_used',
      'username',
    ]) {
      expect(isCredentialKey(key), key).toBe(false);
    }
  });

  it('leaves a record with nothing to redact structurally equal', () => {
    const record = { id: 'x', nested: { list: [1, 'two', null] } };
    const { value, report } = redactCredentials(record);
    expect(value).toEqual(record);
    expect(report.removed).toEqual([]);
  });
});
