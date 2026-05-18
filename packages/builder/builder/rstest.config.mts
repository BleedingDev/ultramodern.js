import { withTestPreset } from '@scripts/rstest-config';
import path from 'path';

export default withTestPreset({
  root: __dirname,
  testEnvironment: 'node',
  setupFiles: [
    path.resolve(__dirname, '../../../scripts/rstest-config/setup.ts'),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
