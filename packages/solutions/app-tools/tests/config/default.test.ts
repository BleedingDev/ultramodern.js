import { createDefaultConfig } from '../../src/config/default';

describe('create default config', () => {
  it('should leave precompress unset in core defaults', () => {
    const config = createDefaultConfig({
      metaName: 'modern-js',
      internalDirAlias: '@_modern_internal',
      internalDirectory: '/tmp/.modern',
      internalSrcAlias: '@_modern_src',
      srcDirectory: '/tmp/src',
      sharedDirectory: '/tmp/shared',
    } as any);

    expect(config.output?.precompress).toBeUndefined();
  });
});
