import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Entry point: only wires config and server to the stdio transport and
      // exits the process; not reachable from unit tests.
      exclude: ['src/index.ts'],
      // Measured on 2026-08-17: 93.87 statements / 85.86 branches / 93.75
      // functions / 93.9 lines. The thresholds sit just below that — write the
      // missing tests instead of lowering them.
      thresholds: {
        statements: 90,
        branches: 82,
        functions: 90,
        lines: 90,
      },
    },
  },
});
