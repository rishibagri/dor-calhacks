import { defineConfig } from 'vitest/config';
import { spacetimedbModuleTestPlugin } from 'spacetimedb/server/test-utils/vitest';

// Runs the real SpacetimeDB module (spacetimedb/src, read-only) in-process against the built worker (dist).
export default defineConfig({
  plugins: [spacetimedbModuleTestPlugin()],
  test: { include: ['integration/**/*.test.ts'] },
});
