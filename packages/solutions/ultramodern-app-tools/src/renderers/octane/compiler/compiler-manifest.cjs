const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getOctaneRspackBuildInfo } = require('@octanejs/rspack-plugin');

const name = 'ultramodern:octane:compiler-manifest';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** The released native compiler remains responsible for every transformation. */
class OctaneCompilerManifestPlugin {
  constructor(options) {
    this.options = options;
  }

  apply(compiler) {
    // Applied after Octane's plugin: the last pre-loader runs first on raw bytes.
    if (this.options.emitClientManifest) {
      compiler.options.module.rules.push({
        test: /\.(?:tsrx|[cm]?[jt]sx?)$/u,
        enforce: 'pre',
        use: [{ loader: this.options.sourceLoader }],
      });
    }
    compiler.hooks.normalModuleFactory.tap(name, factory => {
      factory.hooks.beforeResolve.tap(name, result => {
        if (
          /\.svg\?(?:[^#]*&)?(?:react|component)(?:[=&]|$)/u.test(
            result.request,
          )
        ) {
          throw new Error(
            'unsupported-renderer-capability: Octane SVG imports are URL assets; SVG components require a supported native compiler profile.',
          );
        }
      });
    });
    if (!this.options.emitClientManifest) return;
    compiler.hooks.thisCompilation.tap(name, compilation => {
      compilation.hooks.processAssets.tap(
        {
          name,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT + 1,
        },
        () => {
          // Preserve the owning resolver/compiler diagnostic on an invalid graph.
          if (compilation.errors.length) return;
          const buildAsset = compilation.getAsset('octane-client-build.json');
          if (!buildAsset)
            throw new Error(
              'The native Octane client build manifest is missing.',
            );
          const nativeBuild = JSON.parse(buildAsset.source.source().toString());
          if (
            nativeBuild.version !== 1 ||
            nativeBuild.buildId !== compilation.hash
          ) {
            throw new Error(
              'The native Octane client manifest does not match the completed compilation.',
            );
          }
          const sources = [];
          const visited = new Set();
          const visit = (module, inheritedAssets = []) => {
            if (visited.has(module)) return;
            visited.add(module);
            const chunks = [
              ...compilation.chunkGraph.getModuleChunksIterable(module),
            ];
            const assets = [
              ...new Set([
                ...inheritedAssets,
                ...chunks.flatMap(chunk => [...chunk.files]),
              ]),
            ]
              .filter(file => file.endsWith('.js'))
              .sort();
            const info = getOctaneRspackBuildInfo(module);
            if (info && assets.length) {
              const resource = module.resource?.split('?')[0];
              const sourceSha256 =
                module.buildInfo.ultramodernOctaneSourceSha256;
              const emitted = module.originalSource();
              if (!resource || !sourceSha256 || !emitted) {
                throw new Error(
                  `Octane compiled source lacks authenticated provenance: ${module.identifier()}. Rebuild the native compiler cache.`,
                );
              }
              if (digest(fs.readFileSync(resource)) !== sourceSha256) {
                throw new Error(
                  `Octane source changed after compilation: ${resource}. Rebuild the application.`,
                );
              }
              const relative = path.relative(this.options.root, resource);
              sources.push({
                resource:
                  relative.split(path.sep).join('/') +
                  (info.resourceQuery ?? ''),
                canonicalId: info.canonicalId,
                moduleId:
                  compilation.chunkGraph.getModuleId(module) ??
                  module.identifier(),
                transformKind: info.transformKind,
                sourceSha256,
                emittedSourceSha256: digest(emitted.buffer()),
                assets,
              });
            }
            for (const nested of module.modules ?? []) visit(nested, assets);
          };
          for (const module of compilation.modules) visit(module);
          sources.sort((left, right) =>
            left.resource.localeCompare(right.resource),
          );
          const identities = this.options.rendererIdentities();
          if (!identities || !Object.keys(identities).length) {
            throw new Error(
              'Octane compiler requires immutable application entry identities.',
            );
          }
          for (const [entryName, rendererIdentity] of Object.entries(
            identities,
          )) {
            if (
              rendererIdentity?.renderer !== 'octane' ||
              rendererIdentity.entryName !== entryName
            ) {
              throw new Error(
                `Octane compiler identity conflicts with entry ${entryName}.`,
              );
            }
            const entrypoint = compilation.entrypoints.get(entryName);
            if (!entrypoint)
              throw new Error(
                `Octane compiler has no client entry for ${entryName}.`,
              );
            const entryChunks = new Set(entrypoint.chunks);
            for (const chunk of entrypoint.chunks) {
              for (const referenced of chunk.getAllReferencedChunks())
                entryChunks.add(referenced);
            }
            const files = [
              ...new Set(
                [...entryChunks]
                  .flatMap(chunk => [...chunk.files])
                  .filter(file => file.endsWith('.js')),
              ),
            ].sort();
            const fileSet = new Set(files);
            const manifest = {
              schemaVersion: 1,
              renderer: 'octane',
              runtimeVersion: this.options.runtimeVersion,
              compilerVersion: this.options.compilerVersion,
              rendererIdentity,
              nativeHydrationBuildId: nativeBuild.buildId,
              sourceModules: sources.flatMap(source => {
                const assets = source.assets.filter(file => fileSet.has(file));
                return assets.length ? [{ ...source, assets }] : [];
              }),
              assets: files.map(file => ({
                file,
                sha256: digest(compilation.getAsset(file).source.buffer()),
              })),
            };
            this.options.validateManifest(
              manifest,
              rendererIdentity,
              compilation.hash,
            );
            compilation.emitAsset(
              this.options.manifestFilename(entryName),
              new compiler.webpack.sources.RawSource(
                `${JSON.stringify(manifest, null, 2)}\n`,
              ),
            );
          }
        },
      );
    });
  }
}
module.exports = { OctaneCompilerManifestPlugin };
