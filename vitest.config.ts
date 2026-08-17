import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Entry point: only wires config and server to the stdio transport and
      // exits the process; not reachable from unit tests.
      exclude: ['src/index.ts'],
      // Measured on 2026-08-17: 99.61 statements / 91.56 branches / 100
      // functions / 99.6 lines. The thresholds sit just below that, with
      // headroom on functions — write the missing tests instead of lowering
      // them.
      //
      // The two uncovered statements are deliberate belt-and-braces: the
      // package.json fallback in server.ts, and the finite-number guard in
      // delete_bookmark that the zod schema already rejects one layer earlier.
      thresholds: {
        statements: 97,
        branches: 88,
        functions: 95,
        lines: 97,
      },
    },
  },
});
