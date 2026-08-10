rstest.mock('effect', () => {
  throw new Error('optional Effect peer was loaded by the base CLI');
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
