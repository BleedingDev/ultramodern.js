import {
  type DesignSystemContract,
  validateDesignSystemConsumerCompatibility,
  validateDesignSystemContract,
} from '../../src/ultramodern/designSystem';

const validContract: DesignSystemContract = {
  tokenPacks: [
    {
      id: 'acme-core',
      brand: 'acme',
      version: '1.2.0',
      tokens: {
        'color.accent': '#0f766e',
        'space.2': 8,
      },
    },
    {
      id: 'acme-core-stable',
      brand: 'acme',
      version: '1.1.0',
      tokens: {
        'color.accent': '#0369a1',
        'space.2': 8,
      },
    },
  ],
  verticals: {
    commerce: {
      mode: 'components',
      tokenPack: 'acme-core',
      overrides: [
        {
          layer: 'brand',
          tokens: {
            'color.accent': '#115e59',
          },
          reason: 'seasonal brand refresh',
        },
        {
          layer: 'vertical',
          tokens: {
            'space.2': 10,
          },
        },
      ],
      pin: {
        tokenPack: 'acme-core',
        version: '1.2.0',
        rollback: {
          tokenPack: 'acme-core-stable',
          version: '1.1.0',
          reason: 'last approved release',
        },
      },
      consumers: [
        {
          id: 'checkout',
          requiredTokens: ['color.accent', 'space.2'],
          tokenPackVersions: {
            'acme-core': '1.2.0',
          },
        },
      ],
    },
    docs: {
      mode: 'tokens',
      tokenPack: 'acme-core-stable',
    },
    lab: {
      mode: 'off',
    },
  },
};

describe('ultramodern design system contract', () => {
  it('validates a multi-vertical design system contract', () => {
    expect(validateDesignSystemContract(validContract)).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('rejects override layers outside the approved model', () => {
    const result = validateDesignSystemContract({
      ...validContract,
      verticals: {
        commerce: {
          mode: 'components',
          tokenPack: 'acme-core',
          overrides: [
            {
              layer: 'vendor-theme',
            },
          ],
        },
      },
    } as DesignSystemContract);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      {
        path: 'verticals.commerce.overrides[0].layer',
        message: 'override layer "vendor-theme" is not approved',
      },
    ]);
  });

  it('rejects pin and rollback metadata that drift from known token packs', () => {
    const result = validateDesignSystemContract({
      ...validContract,
      verticals: {
        commerce: {
          mode: 'strict',
          tokenPack: 'acme-core',
          pin: {
            tokenPack: 'acme-core-stable',
            version: '1.0.0',
            rollback: {
              tokenPack: 'missing-pack',
              version: '1.0.0',
              reason: '',
            },
          },
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      {
        path: 'verticals.commerce.pin.version',
        message:
          'pinned version "1.0.0" does not match token pack "acme-core-stable" version "1.1.0"',
      },
      {
        path: 'verticals.commerce.pin.tokenPack',
        message:
          'pinned token pack "acme-core-stable" must match selected token pack "acme-core"',
      },
      {
        path: 'verticals.commerce.pin.rollback.tokenPack',
        message: 'unknown rollback token pack "missing-pack"',
      },
      {
        path: 'verticals.commerce.pin.rollback.reason',
        message: 'rollback metadata must include a reason',
      },
    ]);
  });

  it('detects consumer breakage for mode, token version, and required tokens', () => {
    const result = validateDesignSystemConsumerCompatibility(
      {
        mode: 'strict',
        tokenPack: 'acme-core',
        consumers: [
          {
            id: 'legacy-profile',
            unsupportedModes: ['strict'],
            requiredTokens: ['color.accent', 'font.body'],
            tokenPackVersions: {
              'acme-core': '1.1.0',
            },
          },
        ],
      },
      validContract.tokenPacks[0],
      'verticals.profile',
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      {
        path: 'verticals.profile.consumers[0].unsupportedModes',
        message: 'consumer "legacy-profile" does not support "strict" mode',
      },
      {
        path: 'verticals.profile.consumers[0].tokenPackVersions.acme-core',
        message:
          'consumer "legacy-profile" requires "acme-core" version "1.1.0" but received "1.2.0"',
      },
      {
        path: 'verticals.profile.consumers[0].requiredTokens',
        message:
          'consumer "legacy-profile" requires missing token "font.body" from "acme-core"',
      },
    ]);
  });
});
