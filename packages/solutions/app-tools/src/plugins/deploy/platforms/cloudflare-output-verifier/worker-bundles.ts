import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLOUDFLARE_WORKER_BUNDLE_DIRECTORY } from '../cloudflare-output-contract';
import type { CloudflareOutputVerifierIssue, JsonObject } from './issues';
import { addIssue } from './issues';

interface WorkerBundleReference {
  kind: 'effect-bff' | 'route';
  reference: string;
}

interface ResolvedWorkerBundleReference extends WorkerBundleReference {
  path: string;
}

const getReferencedRouteWorkers = (manifest: JsonObject) =>
  Array.isArray(manifest?.routeSpec?.routes)
    ? manifest.routeSpec.routes
        .map((route: any) =>
          typeof route?.worker === 'string' && route.worker.length > 0
            ? route.worker
            : undefined,
        )
        .filter(
          (worker: unknown): worker is string => typeof worker === 'string',
        )
    : [];

export const getEffectBffWorker = (manifest: JsonObject) =>
  manifest?.bff?.runtimeFramework === 'effect' &&
  typeof manifest.bff.worker === 'string'
    ? manifest.bff.worker
    : undefined;

export const getWorkerBundleReferences = (
  manifest: JsonObject,
): WorkerBundleReference[] => {
  const effectBffWorker = getEffectBffWorker(manifest);
  return [
    ...(effectBffWorker
      ? [{ kind: 'effect-bff' as const, reference: effectBffWorker }]
      : []),
    ...getReferencedRouteWorkers(manifest).map(reference => ({
      kind: 'route' as const,
      reference,
    })),
  ];
};

export const resolveWorkerBundleReference = (
  issues: CloudflareOutputVerifierIssue[],
  outputDirectory: string,
  reference: WorkerBundleReference,
  manifestPath: string,
): ResolvedWorkerBundleReference | null => {
  const workerRoot = path.resolve(
    outputDirectory,
    CLOUDFLARE_WORKER_BUNDLE_DIRECTORY,
  );
  const workerPath = path.resolve(outputDirectory, reference.reference);
  const relativeToWorkerRoot = path.relative(workerRoot, workerPath);

  if (
    path.isAbsolute(reference.reference) ||
    relativeToWorkerRoot.startsWith('..') ||
    path.isAbsolute(relativeToWorkerRoot)
  ) {
    addIssue(issues, {
      code: 'invalid-manifest',
      message:
        'Cloudflare output manifest worker bundle references must stay under worker/.',
      path: manifestPath,
    });
    return null;
  }

  return {
    ...reference,
    path: workerPath,
  };
};

export const missingWorkerBundleMessage = (reference: WorkerBundleReference) =>
  reference.kind === 'effect-bff'
    ? 'Cloudflare Effect BFF manifest points to a missing worker bundle.'
    : 'Cloudflare route worker manifest points to a missing worker bundle.';

const FORBIDDEN_WORKER_BUNDLE_REFERENCE_PATTERNS = [
  /\.\.\/server\//u,
  /\.output\/server\//u,
  /server\/index\.mjs/u,
] as const;

export const verifyWorkerBundleReferences = (
  issues: CloudflareOutputVerifierIssue[],
  worker: ResolvedWorkerBundleReference,
  source: string,
) => {
  if (
    FORBIDDEN_WORKER_BUNDLE_REFERENCE_PATTERNS.some(pattern =>
      pattern.test(source),
    )
  ) {
    addIssue(issues, {
      code: 'invalid-worker-bundle',
      message:
        'Cloudflare worker bundles must not reference framework-owned server output paths.',
      path: worker.path,
    });
  }
};

export const verifyWorkerImport = async (
  issues: CloudflareOutputVerifierIssue[],
  entryPath: string,
) => {
  try {
    const worker = (
      await import(`${pathToFileURL(entryPath).href}?t=${Date.now()}`)
    ).default;

    if (!worker || typeof worker.fetch !== 'function') {
      addIssue(issues, {
        code: 'worker-import-failed',
        message:
          'Cloudflare server entry must default-export a Worker with fetch.',
        path: entryPath,
      });
    }
  } catch (error) {
    addIssue(issues, {
      code: 'worker-import-failed',
      message: `Cloudflare server entry could not be imported: ${
        error instanceof Error ? error.message : String(error)
      }`,
      path: entryPath,
    });
  }
};
