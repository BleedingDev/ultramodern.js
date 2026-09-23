import { BFF_EFFECT_WORKER_DISPATCHER_EXPORT } from '../cloudflare/constants';
import {
  CLOUDFLARE_ASSETS_BINDING,
  CLOUDFLARE_PUBLIC_ASSETS_DIRECTORY,
  CLOUDFLARE_RUNTIME_TYPE,
  CLOUDFLARE_WORKER_ENTRY,
} from '../cloudflare-output-contract';
import type { CloudflareOutputVerifierIssue, JsonObject } from './issues';
import { addIssue, assertEqual } from './issues';

export const verifyManifestShape = (
  issues: CloudflareOutputVerifierIssue[],
  manifest: JsonObject,
  manifestPath: string,
) => {
  assertEqual(issues, manifest.runtime?.type, CLOUDFLARE_RUNTIME_TYPE, {
    code: 'invalid-manifest',
    message:
      'Cloudflare output manifest runtime.type must be cloudflare-module-worker.',
    path: manifestPath,
  });
  assertEqual(issues, manifest.runtime?.entry, CLOUDFLARE_WORKER_ENTRY, {
    code: 'invalid-manifest',
    message: `Cloudflare output manifest runtime.entry must be ${CLOUDFLARE_WORKER_ENTRY}.`,
    path: manifestPath,
  });
  assertEqual(issues, manifest.runtime?.fetchExport, true, {
    code: 'invalid-manifest',
    message: 'Cloudflare output manifest runtime.fetchExport must be true.',
    path: manifestPath,
  });
  assertEqual(issues, manifest.runtime?.nodeListen, false, {
    code: 'invalid-manifest',
    message: 'Cloudflare output manifest runtime.nodeListen must be false.',
    path: manifestPath,
  });
  assertEqual(issues, manifest.assets?.binding, CLOUDFLARE_ASSETS_BINDING, {
    code: 'invalid-manifest',
    message: 'Cloudflare output manifest assets.binding must be ASSETS.',
    path: manifestPath,
  });
  assertEqual(
    issues,
    manifest.assets?.directory,
    `./${CLOUDFLARE_PUBLIC_ASSETS_DIRECTORY}`,
    {
      code: 'invalid-manifest',
      message: 'Cloudflare output manifest assets.directory must be ./public.',
      path: manifestPath,
    },
  );
  assertEqual(issues, manifest.assets?.runWorkerFirst, true, {
    code: 'invalid-manifest',
    message: 'Cloudflare output manifest assets.runWorkerFirst must be true.',
    path: manifestPath,
  });
  if (!Array.isArray(manifest.routeSpec?.routes)) {
    addIssue(issues, {
      code: 'invalid-manifest',
      message: 'Cloudflare output manifest routeSpec.routes must be array.',
      path: manifestPath,
    });
  }
  const security = manifest.security;
  if (
    !security ||
    typeof security !== 'object' ||
    typeof security.enabled !== 'boolean'
  ) {
    addIssue(issues, {
      code: 'invalid-manifest',
      message: 'Cloudflare output manifest security.enabled must be a boolean.',
      path: manifestPath,
    });
  } else {
    const cors = security.cors;
    if (
      !cors ||
      typeof cors !== 'object' ||
      typeof cors.assets !== 'boolean' ||
      !Array.isArray(cors.allowedOrigins) ||
      !Array.isArray(cors.allowedMethods) ||
      !Array.isArray(cors.allowedHeaders)
    ) {
      addIssue(issues, {
        code: 'invalid-manifest',
        message: 'Cloudflare output manifest security.cors is incomplete.',
        path: manifestPath,
      });
    }
    if (security.enabled) {
      const headers = security.headers;
      const csp = security.contentSecurityPolicy;
      const noindex = security.noindex;
      if (
        !headers ||
        typeof headers !== 'object' ||
        !['string', 'boolean'].includes(typeof headers.referrerPolicy) ||
        !['string', 'boolean'].includes(typeof headers.contentTypeOptions) ||
        !['string', 'boolean'].includes(typeof headers.permissionsPolicy)
      ) {
        addIssue(issues, {
          code: 'invalid-manifest',
          message: 'Cloudflare output manifest security.headers is incomplete.',
          path: manifestPath,
        });
      }
      if (
        !csp ||
        !['off', 'report-only', 'enforce'].includes(csp.mode) ||
        !csp.directives ||
        typeof csp.directives !== 'object' ||
        Array.isArray(csp.directives) ||
        Object.values(csp.directives).some(
          value =>
            !Array.isArray(value) ||
            value.some(entry => typeof entry !== 'string'),
        )
      ) {
        addIssue(issues, {
          code: 'invalid-manifest',
          message:
            'Cloudflare output manifest security.contentSecurityPolicy is invalid.',
          path: manifestPath,
        });
      }
      if (
        !noindex ||
        typeof noindex.workersDev !== 'boolean' ||
        typeof noindex.localhost !== 'boolean' ||
        !Array.isArray(noindex.previewHostnames)
      ) {
        addIssue(issues, {
          code: 'invalid-manifest',
          message: 'Cloudflare output manifest security.noindex is incomplete.',
          path: manifestPath,
        });
      }
    }
  }
  if (manifest.bff?.runtimeFramework === 'effect') {
    assertEqual(
      issues,
      manifest.bff.dispatcherExport,
      BFF_EFFECT_WORKER_DISPATCHER_EXPORT,
      {
        code: 'invalid-manifest',
        message: `Cloudflare Effect BFF manifest dispatcherExport must be ${BFF_EFFECT_WORKER_DISPATCHER_EXPORT}.`,
        path: manifestPath,
      },
    );
  }
};
