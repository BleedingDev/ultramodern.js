import {
  getSupportedDeployTargets,
  resolveDeployTarget,
} from '../../src/plugins/deploy';

describe('deploy target selection', () => {
  it('registers cloudflare without removing existing targets', () => {
    expect(getSupportedDeployTargets()).toEqual([
      'node',
      'vercel',
      'netlify',
      'ghPages',
      'cloudflare',
    ]);
  });

  it('prefers typed config over environment and provider detection', () => {
    const target = resolveDeployTarget(
      {
        deploy: {
          target: 'cloudflare',
        },
      } as any,
      'vercel',
      'netlify',
    );

    expect(target).toBe('cloudflare');
  });

  it('preserves existing environment and provider fallback order', () => {
    expect(resolveDeployTarget({ deploy: {} } as any, 'vercel')).toBe('vercel');
    expect(
      resolveDeployTarget({ deploy: {} } as any, undefined, 'netlify'),
    ).toBe('netlify');
    expect(
      resolveDeployTarget({ deploy: {} } as any, undefined, undefined),
    ).toBe('node');
  });
});
