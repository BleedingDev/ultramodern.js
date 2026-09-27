import {
  DEPLOY_TARGETS,
  getDeployingTarget,
  resolveDeployTarget,
} from '../../src/deploy-output/target';

const argv = (...args: string[]) => ['build', ...args];

describe('resolveDeployTarget', () => {
  it('resolves --deploy-target > deploy.target > MODERNJS_DEPLOY > provider > node', () => {
    const all = {
      argv: argv('--deploy-target', 'vercel'),
      configTarget: 'netlify',
      env: 'ghPages',
      provider: 'cloudflare_pages',
    };
    expect(resolveDeployTarget(all)).toEqual({
      target: 'vercel',
      explicit: true,
    });
    expect(
      resolveDeployTarget({ ...all, argv: argv('--deploy-target=node') }),
    ).toEqual({ target: 'node', explicit: true });
    expect(resolveDeployTarget({ ...all, argv: argv() })).toEqual({
      target: 'netlify',
      explicit: true,
    });
    expect(
      resolveDeployTarget({ ...all, argv: argv(), configTarget: undefined }),
    ).toEqual({ target: 'ghPages', explicit: true });
    expect(
      resolveDeployTarget({
        ...all,
        argv: argv(),
        configTarget: undefined,
        env: '',
      }),
    ).toEqual({ target: 'cloudflare', explicit: false });
    expect(
      resolveDeployTarget({
        argv: argv(),
        env: '',
        provider: 'github_actions',
      }),
    ).toEqual({ target: 'node', explicit: false });
  });

  it('maps every Cloudflare provider id to the cloudflare target', () => {
    for (const provider of [
      'cloudflare',
      'cloudflare_pages',
      'cloudflare_workers',
    ]) {
      expect(
        resolveDeployTarget({ argv: argv(), env: '', provider }).target,
      ).toBe('cloudflare');
    }
  });

  it('throws on an unknown target from any explicit source', () => {
    expect(() =>
      resolveDeployTarget({ argv: argv('--deploy-target', 'cloudflar') }),
    ).toThrow(
      `Unknown deploy target 'cloudflar' from --deploy-target. Use one of: ${DEPLOY_TARGETS.join(', ')}.`,
    );
    expect(() =>
      resolveDeployTarget({ argv: argv(), configTarget: 'aws' }),
    ).toThrow(/from deploy\.target/u);
    expect(() => resolveDeployTarget({ argv: argv(), env: 'aws' })).toThrow(
      /from MODERNJS_DEPLOY/u,
    );
    expect(() =>
      resolveDeployTarget({ argv: argv('--deploy-target') }),
    ).toThrow('--deploy-target needs a value.');
  });
});

describe('getDeployingTarget', () => {
  it('deploys a detected target only for the modern-js CLI', () => {
    const detected = { target: 'vercel', explicit: false } as const;
    expect(
      getDeployingTarget({ metaName: 'modern-js', deployTarget: detected }),
    ).toBe('vercel');
    expect(
      getDeployingTarget({ metaName: 'custom', deployTarget: detected }),
    ).toBeUndefined();
    expect(
      getDeployingTarget({
        metaName: 'custom',
        deployTarget: { ...detected, explicit: true },
      }),
    ).toBe('vercel');
  });
});
