import { withTestPreset } from '@scripts/rstest-config';

export default withTestPreset({
  root: __dirname,
  testEnvironment: 'node',
  globals: true,
  tools: {
    swc: {
      jsc: {
        transform: {
          react: {
            // The data loader runtime renders nested routes from source.
            runtime: 'automatic',
          },
        },
      },
    },
  },
});
