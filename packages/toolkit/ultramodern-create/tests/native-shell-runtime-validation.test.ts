import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import {
  createVerticalDescriptor,
  sharedPackages,
} from '../src/ultramodern-workspace/descriptors';
import { assertCompilerArchitecture } from '../src/ultramodern-workspace/validation/architecture';
import { createWorkspaceValidationContract } from '../src/ultramodern-workspace/workspace-validation-contract';
import {
  linkInstalledCompiler,
  linkInstalledEffectCompiler,
} from './helpers/workspace-kit';

const runtimeImport =
  "import { getInstance } from '@module-federation/modern-js-v3/runtime';";

// Shell route sources the compiler must admit.
const admitted = {
  'build-target conditions': `
export const target = () => {
  if (import.meta.env.MODERN_TARGET === 'browser') return 'browser';
  if ('node' === import.meta.env.MODERN_TARGET && Math.random() > 1) return 'never';
  return import.meta.env.MODERN_TARGET === 'node' ? 'server' : 'unknown';
};
`,
  'browser-guarded loads on a dynamically imported instance': `
export const loadPage = async () => {
  if (import.meta.env.MODERN_TARGET === 'browser') {
    const { getInstance } = await import('@module-federation/modern-js-v3/runtime');
    const host = getInstance();
    if (host === null) return undefined;
    await host.loadShare('react');
    return host.loadRemote<{ default: unknown }>('inventory/Widget');
  }
  return undefined;
};
`,
  'a browser-guarded ternary on a statically imported instance': `
${runtimeImport}
export const load = (enabled: boolean) => {
  const host = getInstance()!;
  return import.meta.env.MODERN_TARGET === 'browser' && enabled
    ? host.loadRemote('inventory/Widget')
    : undefined;
};
`,
};

// Shell route sources that read process.env. Generated type checking rejects
// every process.env read, including the build target, so validation does too.
const processEnvironment = {
  'a process.env build-target condition':
    "export const run = () => { if (process.env.MODERN_TARGET === 'browser') return 1; };",
  'another environment variable':
    "export const run = () => { if (process.env.API_URL === 'browser') return 1; };",
  'a process.env-guarded instance load': `
${runtimeImport}
export const load = () => {
  if (process.env.MODERN_TARGET === 'browser') return getInstance()!.loadRemote('inventory/Widget');
};
`,
};

// Shell route sources that load remotes outside the native browser path.
const manualLoading = {
  'an unguarded instance load': `
${runtimeImport}
export const load = () => getInstance()!.loadRemote('inventory/Widget');
`,
  'a node-guarded instance load': `
${runtimeImport}
export const load = () => {
  if (import.meta.env.MODERN_TARGET === 'node') return getInstance()!.loadRemote('inventory/Widget');
};
`,
  'an instance load guarded by loose equality': `
${runtimeImport}
export const load = () => {
  if (import.meta.env.MODERN_TARGET == 'browser') return getInstance()!.loadRemote('inventory/Widget');
};
`,
  'an instance load guarded by an undefined build target': `
${runtimeImport}
export const load = () => {
  if (import.meta.env.MODERN_TARGET === 'edge') return getInstance()!.loadRemote('inventory/Widget');
};
`,
  'an instance load guarded through optional chaining': `
${runtimeImport}
export const load = () => {
  if (import.meta.env?.MODERN_TARGET === 'browser') return getInstance()!.loadRemote('inventory/Widget');
};
`,
  'an instance load guarded by a stored comparison': `
${runtimeImport}
const isBrowser = import.meta.env.MODERN_TARGET === 'browser';
export const load = () => {
  if (isBrowser) return getInstance()!.loadRemote('inventory/Widget');
};
`,
  'an instance load in the else branch of a browser guard': `
${runtimeImport}
export const load = () => {
  if (import.meta.env.MODERN_TARGET === 'browser') return undefined;
  else return getInstance()!.loadRemote('inventory/Widget');
};
`,
  'an instance load guarded by a disjunction': `
${runtimeImport}
export const load = (enabled: boolean) => {
  if (import.meta.env.MODERN_TARGET === 'browser' || enabled) return getInstance()!.loadRemote('inventory/Widget');
};
`,
  'a hand-rolled loader object': `
${runtimeImport}
const host = { loadRemote: (id: string) => import(id), instance: getInstance() };
export const load = () => {
  if (import.meta.env.MODERN_TARGET === 'browser') return host.loadRemote('inventory/Widget');
};
`,
  'a look-alike ModuleFederation class': `
${runtimeImport}
class ModuleFederation { loadRemote(id: string) { return import(id); } }
export const load = () => {
  getInstance();
  if (import.meta.env.MODERN_TARGET === 'browser') return new ModuleFederation().loadRemote('inventory/Widget');
};
`,
  'an untyped receiver': `
${runtimeImport}
declare const host: any;
export const load = () => {
  getInstance();
  if (import.meta.env.MODERN_TARGET === 'browser') return host.loadShare('react');
};
`,
  'a browser-guarded runtime loadRemote function': `
import { loadRemote } from '@module-federation/modern-js-v3/runtime';
export const load = () => {
  if (import.meta.env.MODERN_TARGET === 'browser') return loadRemote('inventory/Widget');
};
`,
};

test('shell routes may branch on the build target and load through the native browser instance', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-native-shell-runtime-'),
  );
  const targetDir = path.join(tempRoot, 'workspace');
  try {
    await generateUltramodernWorkspace({
      targetDir,
      packageName: 'native-shell-runtime',
      modernVersion: '3.9.3',
      generateAgentFiles: false,
      enableTailwind: false,
      packageSource: { strategy: 'workspace' },
    });
    linkInstalledCompiler(targetDir);
    linkInstalledEffectCompiler(targetDir);
    // The checker types the receiver from the installed Module Federation runtime.
    const federationPath = path.join(
      targetDir,
      'node_modules/@module-federation/modern-js-v3',
    );
    fs.mkdirSync(path.dirname(federationPath), { recursive: true });
    fs.symlinkSync(
      fs.realpathSync(
        path.join(__dirname, '../node_modules/@module-federation/modern-js-v3'),
      ),
      federationPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await addUltramodernVertical({
      workspaceRoot: targetDir,
      name: 'inventory',
      modernVersion: '3.9.3',
      enableTailwind: false,
      packageSource: { strategy: 'workspace' },
    });
    const contract = createWorkspaceValidationContract(
      'native-shell-runtime',
      false,
      sharedPackages.map(pkg => ({
        id: pkg.id,
        path: pkg.directory,
        package: `native-shell-runtime/${pkg.id}`,
      })),
      [createVerticalDescriptor('inventory', 4101)],
    );
    assert.doesNotThrow(() => assertCompilerArchitecture(targetDir, contract));

    const routeFile = path.join(
      targetDir,
      'apps/shell-super-app/src/routes/native-runtime-proof.tsx',
    );
    const expectations: Array<[Record<string, string>, RegExp | undefined]> = [
      [admitted, undefined],
      [processEnvironment, /framework config API direct-process-env-access/u],
      [manualLoading, /module federation native loading/u],
    ];
    for (const [cases, failure] of expectations) {
      for (const [name, source] of Object.entries(cases)) {
        fs.writeFileSync(routeFile, source);
        if (failure === undefined) {
          assert.doesNotThrow(
            () => assertCompilerArchitecture(targetDir, contract),
            name,
          );
        } else {
          assert.throws(
            () => assertCompilerArchitecture(targetDir, contract),
            failure,
            name,
          );
        }
      }
    }
    fs.rmSync(routeFile);

    // Config runs in Node, where the framework defines no build target.
    const configFile = path.join(
      targetDir,
      'apps/shell-super-app/modern.config.ts',
    );
    const config = fs.readFileSync(configFile, 'utf8');
    fs.writeFileSync(
      configFile,
      `${config}\nif (import.meta.env.MODERN_TARGET === 'browser') { console.log('browser'); }\n`,
    );
    assert.throws(
      () => assertCompilerArchitecture(targetDir, contract),
      /framework config API build-target-outside-bundle/u,
    );
    fs.writeFileSync(configFile, config);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
