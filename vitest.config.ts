import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['tests/rules/**', 'node_modules/**', 'dist/**'],
  },
});
