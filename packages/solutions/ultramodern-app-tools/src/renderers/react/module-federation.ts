import { createRequire } from 'node:module';
import {
  type RendererFederationCompatibility,
  readRendererFederationCompatibility,
  rendererFederationError,
} from '@modern-js/federation-runtime/renderer-contract';
import { readRendererFrameworkPackage } from '../../native-composition/renderer-installed-profile';
import { resolveRendererProfileMetadata } from '../../native-composition/renderer-profile';

export function resolveReactFederationCompatibility(): RendererFederationCompatibility {
  const metadata = resolveRendererProfileMetadata('react');
  const runtimeFile = createRequire(import.meta.url).resolve(
    '@modern-js/runtime/cli',
  );
  const runtimeRequire = createRequire(runtimeFile);
  const runtime = readRendererFrameworkPackage({
    specifier: 'react',
    filename: runtimeRequire.resolve('react'),
  });
  const bootstrap = metadata.frameworkPackages.find(
    owner => owner.specifier === '@modern-js/runtime',
  );
  if (!bootstrap)
    throw rendererFederationError(
      'the installed React bootstrap owner is absent.',
    );
  const { renderer, protocolVersion, compiler, hydration, router } =
    metadata.profile;
  return readRendererFederationCompatibility({
    profile: { renderer, protocolVersion, compiler, hydration, router },
    runtime: { name: runtime.name, version: runtime.version },
    bootstrap: { name: bootstrap.name, version: bootstrap.version },
  });
}
