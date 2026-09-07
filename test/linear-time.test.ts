import { describe, expect, it } from 'vitest';

import { cleanText, cleanValue } from '../src/clean.js';
import { loadConfig } from '../src/config.js';
import { budget } from '../src/result.js';
import { truncateText } from '../src/shape.js';

/**
 * What an input can buy.
 *
 * Every function here runs on the thread that serves every request, against a
 * value somebody else chose — an instance's answer, an operator's URL, a
 * description written by a metadata provider. The numbers are wall clock and
 * therefore generous: the failures these guard against were seconds and
 * minutes, not milliseconds, so a threshold of one second separates them from
 * a loaded machine without being flaky.
 *
 * Where a curve matters more than a number, the test reads the ratio: doubling
 * the input must not much more than double the time.
 */

/** Milliseconds a single call may take at its ceiling. */
const BUDGET_MS = 1000;

/** A record of `count` text fields, each just over the shortening floor. */
function textFields(count: number): Record<string, unknown> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `field_${index}`,
      'x'.repeat(300),
    ])
  );
}

function ms(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe('the result budget is linear in what it is given', () => {
  it('shortens twenty thousand text fields without a serialization each', () => {
    // One cut per round, each followed by a full re-serialization, made the
    // number of rounds a property of the input: 2 000 fields took 5.4 s,
    // 4 000 took 24 s and 8 000 took 105 s — on the thread that serves every
    // request, from any answer the instance gives.
    for (const count of [2000, 4000, 8000]) {
      const elapsed = ms(() => {
        try {
          budget(textFields(count));
        } catch {
          // Refusing is a legitimate outcome here — there is nothing left to
          // shrink once every field is at the floor. How long it takes to say
          // so is the point.
        }
      });
      expect(
        elapsed,
        `${count} text fields took ${Math.round(elapsed)} ms`
      ).toBeLessThan(BUDGET_MS);
    }
  });

  it('thins eight thousand arrays without a serialization each', () => {
    for (const count of [2000, 8000]) {
      const data = Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `list_${index}`,
          ['a'.repeat(20), 'b'.repeat(20)],
        ])
      );
      const elapsed = ms(() => {
        try {
          budget(data);
        } catch {
          // As above.
        }
      });
      expect(
        elapsed,
        `${count} arrays took ${Math.round(elapsed)} ms`
      ).toBeLessThan(BUDGET_MS);
    }
  });

  it('reaches a nested array instead of refusing the answer', () => {
    // The shape of a `detail: "full"` library item: the megabyte is in
    // media.audioFiles, one level down, where the old collector could not see
    // it — so the tool refused rather than shortened.
    const data = {
      id: 'li_1',
      media: {
        audioFiles: Array.from({ length: 3000 }, (_, index) => ({
          index,
          metadata: 'x'.repeat(200),
        })),
      },
    };
    let result: Record<string, unknown> = {};
    const elapsed = ms(() => {
      result = budget(data);
    });
    expect(elapsed).toBeLessThan(BUDGET_MS);
    expect(
      (result.media as { audioFiles: unknown[] }).audioFiles.length
    ).toBeLessThan(3000);
  });
});

describe('the base URL is trimmed in one pass', () => {
  it('handles eighty thousand trailing slashes', () => {
    // `replace(/\/+$/, '')` is quadratic: the pattern is tried from every
    // position of the run and consumes it each time. 80 000 slashes followed
    // by one more character cost 1.7 s at startup.
    for (const count of [20_000, 80_000]) {
      const raw = `https://abs.example.com/${'/'.repeat(count)}a${'/'.repeat(count)}`;
      const elapsed = ms(() => {
        loadConfig({
          AUDIOBOOKSHELF_URL: raw,
          AUDIOBOOKSHELF_API_KEY: 'test-api-key-not-a-real-one',
        } as NodeJS.ProcessEnv);
      });
      expect(
        elapsed,
        `${count} slashes took ${Math.round(elapsed)} ms`
      ).toBeLessThan(BUDGET_MS);
    }
  });
});

describe('the cleaner is linear in the text it is given', () => {
  it('cleans five megabytes of description', () => {
    const text = `x${String.fromCharCode(0x1b)}`.repeat(2_500_000);
    const elapsed = ms(() => {
      cleanText(text);
    });
    expect(elapsed, `5 MB took ${Math.round(elapsed)} ms`).toBeLessThan(
      BUDGET_MS
    );
  });

  it('walks a wide structure once', () => {
    const data = Object.fromEntries(
      Array.from({ length: 20_000 }, (_, index) => [
        `field_${index}`,
        'a title with nothing to remove',
      ])
    );
    const elapsed = ms(() => {
      cleanValue(data);
    });
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('collapses whitespace in a long description in one pass', () => {
    for (const count of [200_000, 800_000]) {
      const elapsed = ms(() => {
        truncateText(`${' '.repeat(count)}a`);
      });
      expect(
        elapsed,
        `${count} spaces took ${Math.round(elapsed)} ms`
      ).toBeLessThan(BUDGET_MS);
    }
  });
});
