import type { Rspack, rspack } from '@rsbuild/core';

export const REACT_BUILD_MARKER_EXPRESSION =
  '__webpack_require__.__ultramodern_build_marker__';
export const REACT_SOURCE_REVISION_EXPRESSION =
  '__webpack_require__.__ultramodern_source_revision__';

export interface ReactBuildMarkerBinding {
  readonly buildMarker: string;
  readonly sourceRevision: string;
}

export interface ReactBuildMarkerBindingOptions {
  /** The owning phase publishes a binding only after discovery completes. */
  getBinding(): ReactBuildMarkerBinding | undefined;
  /** Discovery compiles the native graph without publishing its assets. */
  shouldEmit(): boolean;
}

type RuntimeNamespace = Pick<typeof rspack, 'RuntimeModule' | 'RuntimeGlobals'>;

interface ShouldEmitHook {
  // Native SyncBailHook continues to later taps when a callback is undefined.
  // Rspack's boolean return declaration omits that supported hook result.
  tap(
    name: string,
    callback: (compilation: Rspack.Compilation) => boolean | undefined,
  ): void;
}

function readBinding(
  options: ReactBuildMarkerBindingOptions,
): ReactBuildMarkerBinding {
  const binding = options.getBinding();
  if (
    !binding ||
    typeof binding.buildMarker !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(binding.buildMarker) ||
    typeof binding.sourceRevision !== 'string' ||
    !binding.sourceRevision.trim()
  ) {
    throw new Error(
      'React emitting compilation requires its finalized runtime build identity',
    );
  }
  return binding;
}

/** Bind caller-local compiler constants through the native runtime module. */
export function installReactBuildMarkerBinding(
  compiler: Rspack.Compiler,
  runtime: RuntimeNamespace,
  options: ReactBuildMarkerBindingOptions,
): void {
  const name = 'UltraModernReactBuildMarkerBinding';
  const shouldEmit: ShouldEmitHook = compiler.hooks.shouldEmit;
  shouldEmit.tap(name, () => {
    if (!options.shouldEmit()) return false;
    readBinding(options);
    return undefined;
  });
  compiler.hooks.thisCompilation.tap(name, compilation => {
    class BuildMarkerRuntimeModule extends runtime.RuntimeModule {
      constructor() {
        super('ultramodern build identity', runtime.RuntimeModule.STAGE_BASIC);
      }

      override generate(): string {
        if (!options.shouldEmit()) return '';
        const binding = readBinding(options);
        const require = runtime.RuntimeGlobals.require;
        return `${require}.__ultramodern_build_marker__ = ${JSON.stringify(binding.buildMarker)};\n${require}.__ultramodern_source_revision__ = ${JSON.stringify(binding.sourceRevision)};`;
      }
    }

    compilation.hooks.additionalTreeRuntimeRequirements.tap(
      name,
      (chunk, requirements) => {
        requirements.add(runtime.RuntimeGlobals.require);
        compilation.addRuntimeModule(chunk, new BuildMarkerRuntimeModule());
      },
    );
  });
}
