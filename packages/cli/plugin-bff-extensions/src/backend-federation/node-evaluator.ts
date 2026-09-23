import { createRequire } from 'node:module';
import { evaluateNodeBackendFederationCommonJs } from '@modern-js/server-runtime-extensions/backend-federation-security/node';

const fromAdapter = createRequire(import.meta.url);
const fromEffectPackage = createRequire(
  fromAdapter.resolve('@modern-js/bff-effect/package.json'),
);
const privateRegistry = fromEffectPackage(`#effect-entry-shape-${'registry'}`);

export const evaluateEffectBackendFederationCommonJs = (
  source: Parameters<typeof evaluateNodeBackendFederationCommonJs>[0],
  context: Parameters<typeof evaluateNodeBackendFederationCommonJs>[1],
) => evaluateNodeBackendFederationCommonJs(source, context, privateRegistry);
