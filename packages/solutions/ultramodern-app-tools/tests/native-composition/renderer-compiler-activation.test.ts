import { describe, expect, it } from '@rstest/core';
import { resolveRendererRegistration } from '../../src/native-composition/renderer-registration';
import { createCompilerActivationFixture } from './compiler-activation-fixture';

const options = { rendererIdentities: () => ({}) };

describe('package-owned Node compiler activation', () => {
  it('keeps published compiler declarations immutable without exposing a callback', () => {
    for (const renderer of ['solid', 'octane'] as const) {
      const selected = resolveRendererRegistration(renderer);
      if (selected.kind !== 'native') throw new Error('Missing native fixture');
      expect(Object.isFrozen(selected.nativeAdapter)).toBe(true);
      expect(Object.isFrozen(selected.nativeAdapter.compiler)).toBe(true);
      expect(Object.isFrozen(selected.nativeAdapter.compiler.module)).toBe(
        true,
      );
      expect(selected.nativeAdapter).not.toHaveProperty('createCompiler');
    }
  });

  it.each([
    'source',
    'import',
  ] as const)('activates only the selected emitted compiler from a %s dispatcher', async format => {
    const fixture = await createCompilerActivationFixture({ format });
    try {
      const compiler = await fixture.activate('solid', options);
      expect(compiler).toMatchObject({
        name: 'fixture:solid:compiler',
        rendererIdentities: options.rendererIdentities,
      });
      expect(fixture.calls()).toEqual([
        { renderer: 'solid', format: 'import', action: 'loaded' },
        { renderer: 'solid', format: 'import', action: 'factory' },
      ]);
    } finally {
      fixture.cleanup();
    }
  });

  it('preserves physical owner paths containing URL fragment and query characters', async () => {
    const fixture = await createCompilerActivationFixture({
      specialPath: true,
    });
    try {
      expect(fixture.root).toContain('#?');
      const compiler = await fixture.activate('solid', options);
      expect(compiler.name).toBe('fixture:solid:compiler');
      expect(fixture.calls()).toEqual([
        { renderer: 'solid', format: 'import', action: 'loaded' },
        { renderer: 'solid', format: 'import', action: 'factory' },
      ]);
    } finally {
      fixture.cleanup();
    }
  });

  it('activates another declared owner through the same Node dispatcher', async () => {
    const fixture = await createCompilerActivationFixture();
    try {
      const compiler = await fixture.activate('octane', options);
      expect(compiler.name).toBe('fixture:octane:compiler');
      expect(fixture.calls()).toEqual([
        { renderer: 'octane', format: 'import', action: 'loaded' },
        { renderer: 'octane', format: 'import', action: 'factory' },
      ]);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects React and an unregistered renderer before loading a compiler', async () => {
    const fixture = await createCompilerActivationFixture();
    try {
      await expect(fixture.activate('react', options)).rejects.toThrow(
        'has no native compiler activation',
      );
      await expect(
        fixture.activate('unregistered-native', options),
      ).rejects.toThrow('Unsupported UltraModern renderer');
      expect(fixture.calls()).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects a compiler declaration for another renderer', async () => {
    const fixture = await createCompilerActivationFixture({
      replaceActivation: activation => ({ ...activation, renderer: 'foreign' }),
    });
    try {
      await expect(fixture.activate('solid', options)).rejects.toThrow(
        'Invalid native compiler activation',
      );
      expect(fixture.calls()).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects mutable compiler module declarations', async () => {
    const fixture = await createCompilerActivationFixture({
      freezeModule: false,
    });
    try {
      await expect(fixture.activate('solid', options)).rejects.toThrow(
        'Invalid native compiler activation',
      );
      expect(fixture.calls()).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects source and emitted entries for different compiler owners', async () => {
    const fixture = await createCompilerActivationFixture({
      replaceActivation: activation => ({
        ...activation,
        module: {
          ...activation.module,
          import: './dist/esm-node/renderers/foreign/compiler/index.mjs',
        },
      }),
    });
    try {
      await expect(fixture.activate('solid', options)).rejects.toThrow(
        'Conflicting compiler module formats',
      );
      expect(fixture.calls()).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects a compiler entry that leaves its package', async () => {
    const fixture = await createCompilerActivationFixture({
      replaceActivation: activation => ({
        ...activation,
        module: {
          ...activation.module,
          source: './src/../../another-package/compiler/index.ts',
        },
      }),
    });
    try {
      await expect(fixture.activate('solid', options)).rejects.toThrow(
        'Conflicting compiler module formats',
      );
      expect(fixture.calls()).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('requires the declared factory export from the selected Node module', async () => {
    const fixture = await createCompilerActivationFixture({
      replaceActivation: activation => ({
        ...activation,
        export: 'missingCompilerFactory',
      }),
    });
    try {
      await expect(fixture.activate('solid', options)).rejects.toThrow(
        'does not export missingCompilerFactory',
      );
      expect(fixture.calls()).toEqual([
        { renderer: 'solid', format: 'import', action: 'loaded' },
      ]);
    } finally {
      fixture.cleanup();
    }
  });
});
