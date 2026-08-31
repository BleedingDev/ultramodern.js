rstest.mock('effect', () => {
  throw new Error('optional Effect peer was loaded by the base CLI');
});
rstest.mock('@effect/opentelemetry', () => {
  throw new Error('optional Effect telemetry was loaded by the base CLI');
});
rstest.mock('@modern-js/plugin-bff-extensions/client-generator', () => {
  throw new Error('Effect client generator was loaded by the base CLI');
});

describe('optional Effect peer', () => {
  test('loads the base BFF CLI without evaluating Effect', async () => {
    await expect(import('../src/cli')).resolves.toEqual(
      expect.objectContaining({
        bffPlugin: expect.any(Function),
      }),
    );
  });
});
