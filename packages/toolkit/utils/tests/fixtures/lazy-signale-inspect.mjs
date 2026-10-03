// Each child starts with the actual vendored Signale uncached. Loading the
// observer before changing cwd cannot silently turn an eager import into a pass.
async function inspectSignale(ownerRoot, appRoot, moduleKind, action) {
  const { default: fs } = await import('node:fs');
  const { default: path } = await import('node:path');
  const { createRequire } = await import('node:module');
  const owningRequire = createRequire(path.join(ownerRoot, 'package.json'));
  const providerRequire = createRequire(
    path.resolve(ownerRoot, '../plugin/package.json'),
  );
  const { createJiti } = providerRequire('jiti');
  const helperLoader = createJiti(path.join(ownerRoot, 'source-observer.ts'), {
    fsCache: false,
  });
  const helperRoot = path.resolve(
    ownerRoot,
    '../../solutions/ultramodern-app-tools/src/native-composition/config-evaluator',
  );
  const { initializeOwningConfigNativeBinding } = helperLoader(
    path.join(helperRoot, 'native-bootstrap.ts'),
  );
  const { observeConfigSourceInputs } = helperLoader(
    path.join(helperRoot, 'observed-inputs.ts'),
  );
  const { captureConfigSourceSnapshot, assertConfigSourceSnapshotUnchanged } =
    helperLoader(path.join(helperRoot, 'source-snapshot.ts'));
  const nativeBinding = initializeOwningConfigNativeBinding();
  const nativeEntry = owningRequire.resolve(
    moduleKind === 'source'
      ? './compiled/signale/index.js'
      : './dist/compiled/signale/index.js',
  );
  const utilsEntry =
    moduleKind === 'source'
      ? path.join(ownerRoot, 'src/index.ts')
      : owningRequire.resolve('@modern-js/utils');
  const nativeInitiallyCached = Object.hasOwn(owningRequire.cache, nativeEntry);
  const utilsInitiallyCached = Object.hasOwn(owningRequire.cache, utilsEntry);
  if (nativeInitiallyCached || utilsInitiallyCached) {
    throw new Error('The cold child unexpectedly preloaded utils or Signale');
  }
  const sourceLoader = createJiti(path.join(ownerRoot, 'source-utils.ts'), {
    fsCache: false,
  });
  process.chdir(appRoot);
  const manifestFile = path.join(appRoot, 'package.json');
  const snapshot = captureConfigSourceSnapshot({ sourceRoots: [appRoot] });
  const insideOwner = filename => {
    const relative = path.relative(ownerRoot, filename);
    return (
      relative === '' ||
      (relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    );
  };
  const observed = await observeConfigSourceInputs(
    snapshot,
    async () => {
      const utils =
        moduleKind === 'source'
          ? sourceLoader(utilsEntry)
          : moduleKind === 'cjs'
            ? owningRequire('@modern-js/utils')
            : await import('@modern-js/utils');
      const { signale, Signale, DEFAULT_ENTRY_NAME } = utils;
      if (action === 'cold') {
        return {
          constant: DEFAULT_ENTRY_NAME,
          symbolKinds: [typeof signale, typeof Signale],
          nativeLoaded: Object.hasOwn(owningRequire.cache, nativeEntry),
        };
      }
      const timers = new Map();
      const secrets = ['fixture-secret'];
      const instance = new Signale({
        disabled: true,
        scope: 'parent',
        timers,
        secrets,
        stream: process.stdout,
        types: { success: { label: 'passed' } },
        config: { displayScope: false },
      });
      const native = owningRequire(nativeEntry);
      if (action === 'subclass') {
        class Derived extends Signale {
          marker() {
            return 'derived-method';
          }
        }
        const derived = new Derived({ disabled: true });
        return {
          derivedInstance: derived instanceof Derived,
          lazyInstance: derived instanceof Signale,
          nativeInstance: derived instanceof native.Signale,
          derivedPrototype:
            Object.getPrototypeOf(derived) === Derived.prototype,
          inheritedPrototype:
            Object.getPrototypeOf(Derived.prototype) ===
            native.Signale.prototype,
          marker:
            typeof derived.marker === 'function' ? derived.marker() : undefined,
        };
      }
      const initialSettings = { ...instance.currentOptions.config };
      instance.config({ uppercaseLabel: false, displayTimestamp: true });
      const configuredSettings = { ...instance.currentOptions.config };
      const scoped = instance.scope('child');
      const disabled = !instance.isEnabled();
      instance.enable();
      const enabled = instance.isEnabled();
      instance.disable();
      return {
        nativeLoaded: Object.hasOwn(owningRequire.cache, nativeEntry),
        prototypesMatch: Signale.prototype === native.Signale.prototype,
        singletonConstructorPrototype:
          signale.Signale.prototype === native.Signale.prototype,
        instancePrototype:
          Object.getPrototypeOf(instance) === native.Signale.prototype,
        lazyInstance: instance instanceof Signale,
        nativeInstance: instance instanceof native.Signale,
        initialSettings,
        configuredSettings,
        disabled,
        enabled,
        disabledAgain: !instance.isEnabled(),
        scope: {
          name: scoped.scopeName,
          nativeInstance: scoped instanceof native.Signale,
          nativePrototype:
            Object.getPrototypeOf(scoped) === native.Signale.prototype,
          settings: { ...scoped.currentOptions.config },
          timers: scoped.currentOptions.timers === timers,
          stream: scoped.currentOptions.stream === process.stdout,
          secrets: scoped.currentOptions.secrets === secrets,
          customLabel: scoped.currentOptions.types.success.label,
        },
      };
    },
    // Only this exact owning provider root, plus ordinary installed packages,
    // is framework code. The authored app manifest remains covered source.
    filename =>
      filename.split(path.sep).includes('node_modules') ||
      insideOwner(filename),
    undefined,
    nativeBinding,
  );
  assertConfigSourceSnapshotUnchanged(snapshot);
  let mutationRejected = false;
  if (action !== 'cold') {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    fs.writeFileSync(
      manifestFile,
      JSON.stringify({
        ...manifest,
        dependencies: { 'authored-api': 'workspace:*' },
      }),
    );
    try {
      assertConfigSourceSnapshotUnchanged(snapshot);
    } catch (error) {
      mutationRejected =
        error instanceof Error && error.message.includes(manifestFile);
    }
  }
  return {
    nativeInitiallyCached,
    utilsInitiallyCached,
    value: observed.value,
    inputs: observed.consumedSourceInputs,
    mutationRejected,
  };
}

const result = await inspectSignale(...JSON.parse(process.argv[2]));
process.stdout.write(JSON.stringify(result));
