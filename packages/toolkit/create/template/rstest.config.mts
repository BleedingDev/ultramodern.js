import { withModernConfig } from '@modern-js/adapter-rstest';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  extends: withModernConfig(),
  testEnvironment: 'happy-dom',
});
