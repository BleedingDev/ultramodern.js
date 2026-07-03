import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CLOUDFLARE_ASSETS_BINDING,
  CLOUDFLARE_PUBLIC_ASSETS_DIRECTORY,
  CLOUDFLARE_RUNTIME_TYPE,
  CLOUDFLARE_WORKER_BUNDLE_DIRECTORY,
  CLOUDFLARE_WORKER_ENTRY,
  CLOUDFLARE_WORKER_MANIFEST,
} from './cloudflare-output-contract';
import { createCloudflareOutputPlan } from './cloudflare-output-plan';

export type CloudflareOutputVerifierIssueCode =
  | 'missing-file'
  | 'invalid-manifest'
  | 'invalid-wrangler'
  | 'invalid-package'
  | 'public-output-leak'
  | 'missing-worker-bundle'
  | 'invalid-worker-bundle'
  | 'worker-import-failed'
  | 'delivery-unit-drift'
  | 'missing-delivery-unit'
  | 'forbidden-mutation-pattern';

export interface CloudflareOutputVerifierIssue {
  code: CloudflareOutputVerifierIssueCode;
  message: string;
  path?: string;
}

export interface CloudflareDeliveryUnitIdentity {
  unitId: string;
  buildMarker: string;
  sourceRevision: string;
}

export interface VerifyCloudflareOutputOptions {
  outputDirectory: string;
  importWorker?: boolean;
  /**
   * Topology-declared delivery-unit record (from the workspace compact config).
   * When provided, the Cloudflare worker manifest must carry a matching
   * `deliveryUnit` stamp so the deployed worker snapshot is proven to derive
   * from the same delivery unit as the Node/API surfaces (ADR-0019 lane D).
   */
  deliveryUnit?: CloudflareDeliveryUnitIdentity;
}

export interface VerifyCloudflareOutputMutationPolicyOptions {
  scanRoots: string[];
}

export interface CloudflareOutputVerifierResult {
  ok: boolean;
  issues: CloudflareOutputVerifierIssue[];
}

type JsonObject = Record<string, any>;

interface WorkerBundleReference {
  kind: 'effect-bff' | 'route';
  reference: string;
}

interface ResolvedWorkerBundleReference extends WorkerBundleReference {
  path: string;
}

const SOURCE_SCAN_FILE_PATTERN = /\.(?:[cm]?[jt]s|json)$/u;
const SOURCE_SCAN_IGNORED_DIRECTORY_NAMES = new Set([
  '.codex',
  '.fastcontext',
  '.git',
  '.mf',
  '.modernjs',
  '.output',
  'coverage',
  'dist',
  'dist-cloudflare',
  'node_modules',
  'repos',
  'topology',
]);

const FORBIDDEN_MUTATION_PATTERNS: Array<{
  code: CloudflareOutputVerifierIssueCode;
  message: string;
  pattern: RegExp;
}> = [
  {
    code: 'forbidden-mutation-pattern',
    message:
      'Generated Cloudflare server worker output must not be rewritten by app scripts.',
    pattern: /\.output\/server\/index\.mjs/u,
  },
  {
    code: 'forbidden-mutation-pattern',
    message:
      'Generated Cloudflare server worker output must not be rewritten by app scripts.',
    pattern:
      /path\.join\(\s*['"`]\.output['"`]\s*,\s*['"`]server['"`]\s*,\s*['"`]index\.mjs['"`]\s*\)/u,
  },
  {
    code: 'forbidden-mutation-pattern',
    message:
      'Generated Cloudflare BFF worker bundles must not be rewritten by app scripts.',
    pattern: /\.output\/worker\/[^'"`]*\.(?:mjs|cjs|js)/u,
  },
  {
    code: 'forbidden-mutation-pattern',
    message:
      'Generated Cloudflare BFF worker bundles must not be rewritten by app scripts.',
    pattern:
      /path\.join\(\s*['"`]\.output['"`]\s*,\s*['"`]worker['"`]\s*,\s*['"`][^'"`]+\.(?:mjs|cjs|js)['"`]\s*\)/u,
  },
  {
    code: 'forbidden-mutation-pattern',
    message:
      'Drizzle entityKind worker bundle markers must be fixed in the framework toolchain, not post-build scripts.',
    pattern: /replaceAll\(\s*['"`];entityKind(?:,entityKind)?;/u,
  },
  {
    code: 'forbidden-mutation-pattern',
    message:
      'Effect BFF Cloudflare dispatch must not depend on duck-typed runtime helper probing in app scripts.',
    pattern:
      /(?:typeof\s+[^;\n]*dispatchEffectBffRequest|['"`]dispatchEffectBffRequest['"`]\s+in\s+|\.dispatchEffectBffRequest\b)/u,
  },
  {
    code: 'forbidden-mutation-pattern',
    message:
      'Effect BFF Cloudflare dispatch must not branch on handler.length in app scripts.',
    pattern: /\bhandler\s*\.\s*length\b/u,
  },
];

const pathExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const readJson = async (filePath: string) =>
  JSON.parse(await fs.readFile(filePath, 'utf-8')) as JsonObject;

const addIssue = (
  issues: CloudflareOutputVerifierIssue[],
  issue: CloudflareOutputVerifierIssue,
) => {
  issues.push(issue);
};

const assertEqual = (
  issues: CloudflareOutputVerifierIssue[],
  actual: unknown,
  expected: unknown,
  issue: CloudflareOutputVerifierIssue,
) => {
  if (actual !== expected) {
    addIssue(issues, issue);
  }
};

const assertFlag = (
  issues: CloudflareOutputVerifierIssue[],
  flags: unknown,
  flag: string,
  issue: CloudflareOutputVerifierIssue,
) => {
  if (!Array.isArray(flags) || !flags.includes(flag)) {
    addIssue(issues, issue);
  }
};

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

const getEffectBffWorker = (manifest: JsonObject) =>
  manifest?.bff?.runtimeFramework === 'effect' &&
  typeof manifest.bff.worker === 'string'
    ? manifest.bff.worker
    : undefined;

const getWorkerBundleReferences = (
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

const resolveWorkerBundleReference = (
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

const missingWorkerBundleMessage = (reference: WorkerBundleReference) =>
  reference.kind === 'effect-bff'
    ? 'Cloudflare Effect BFF manifest points to a missing worker bundle.'
    : 'Cloudflare route worker manifest points to a missing worker bundle.';

const DELIVERY_UNIT_IDENTITY_FIELDS: Array<
  keyof CloudflareDeliveryUnitIdentity
> = ['unitId', 'buildMarker', 'sourceRevision'];

const verifyDeliveryUnitIdentity = (
  issues: CloudflareOutputVerifierIssue[],
  manifest: JsonObject,
  manifestPath: string,
  declared: CloudflareDeliveryUnitIdentity | undefined,
) => {
  const stamped = manifest?.deliveryUnit;
  const hasStamp = Boolean(stamped) && typeof stamped === 'object';

  // Legacy outputs (no topology declaration and no stamp) are unchanged.
  if (declared) {
    if (!hasStamp) {
      addIssue(issues, {
        code: 'missing-delivery-unit',
        message: `Cloudflare worker manifest is missing the delivery-unit identity declared by the workspace topology (expected unitId ${declared.unitId}, buildMarker ${declared.buildMarker}).`,
        path: manifestPath,
      });
      return;
    }

    for (const field of DELIVERY_UNIT_IDENTITY_FIELDS) {
      assertEqual(issues, stamped[field], declared[field], {
        code: 'delivery-unit-drift',
        message: `Cloudflare worker manifest deliveryUnit.${field} must match the topology delivery-unit record (expected ${declared[field]}, received ${
          stamped[field] ?? 'undefined'
        }).`,
        path: manifestPath,
      });
    }
  }

  // UI and API surface markers must both derive from the one stamped record,
  // proving Cloudflare and Node are surfaces of the same delivery unit.
  if (hasStamp && stamped.surfaces && typeof stamped.surfaces === 'object') {
    for (const surface of ['ui', 'api'] as const) {
      const marker = stamped.surfaces[surface];

      if (!marker || typeof marker !== 'object') {
        addIssue(issues, {
          code: 'missing-delivery-unit',
          message: `Cloudflare worker manifest is missing the ${surface} delivery-unit surface marker.`,
          path: manifestPath,
        });
        continue;
      }

      for (const field of DELIVERY_UNIT_IDENTITY_FIELDS) {
        assertEqual(issues, marker[field], stamped[field], {
          code: 'delivery-unit-drift',
          message: `Cloudflare worker manifest ${surface} surface deliveryUnit.${field} must derive from one delivery-unit record (expected ${
            stamped[field] ?? 'undefined'
          }, received ${marker[field] ?? 'undefined'}).`,
          path: manifestPath,
        });
      }
    }
  }
};

const verifyManifestShape = (
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
};

const walkFiles = async (root: string): Promise<string[]> => {
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (SOURCE_SCAN_IGNORED_DIRECTORY_NAMES.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(entryPath)));
      continue;
    }

    if (SOURCE_SCAN_FILE_PATTERN.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
};

export const verifyCloudflareOutputMutationPolicy = async (
  options: VerifyCloudflareOutputMutationPolicyOptions,
): Promise<CloudflareOutputVerifierResult> => {
  const issues: CloudflareOutputVerifierIssue[] = [];
  const files = (
    await Promise.all(
      options.scanRoots.map(scanRoot => walkFiles(path.resolve(scanRoot))),
    )
  ).flat();

  for (const file of files) {
    const source = await fs.readFile(file, 'utf-8');
    for (const forbidden of FORBIDDEN_MUTATION_PATTERNS) {
      if (forbidden.pattern.test(source)) {
        addIssue(issues, {
          code: forbidden.code,
          message: forbidden.message,
          path: file,
        });
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
};

const verifyWorkerImport = async (
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

export const verifyCloudflareOutput = async (
  options: VerifyCloudflareOutputOptions,
): Promise<CloudflareOutputVerifierResult> => {
  const outputDirectory = path.resolve(options.outputDirectory);
  const issues: CloudflareOutputVerifierIssue[] = [];
  const outputPlan = createCloudflareOutputPlan(outputDirectory);

  for (const relativePath of outputPlan.requiredFiles) {
    const filePath = path.join(outputDirectory, relativePath);
    if (!(await pathExists(filePath))) {
      addIssue(issues, {
        code: 'missing-file',
        message: `Cloudflare output is missing ${relativePath}.`,
        path: filePath,
      });
    }
  }

  const manifestPath = outputPlan.paths.workerManifest;
  const wranglerPath = outputPlan.paths.wranglerConfig;
  const packagePath = outputPlan.paths.outputPackage;
  const workerPackagePath = outputPlan.paths.workerPackage;

  const manifest = (await pathExists(manifestPath))
    ? await readJson(manifestPath)
    : undefined;
  const wrangler = (await pathExists(wranglerPath))
    ? await readJson(wranglerPath)
    : undefined;
  const outputPackage = (await pathExists(packagePath))
    ? await readJson(packagePath)
    : undefined;
  const workerPackage = (await pathExists(workerPackagePath))
    ? await readJson(workerPackagePath)
    : undefined;

  if (manifest) {
    verifyManifestShape(issues, manifest, manifestPath);
    verifyDeliveryUnitIdentity(
      issues,
      manifest,
      manifestPath,
      options.deliveryUnit,
    );

    const workerReferences = getWorkerBundleReferences(manifest);
    if (workerReferences.length > 0 && !(await pathExists(workerPackagePath))) {
      addIssue(issues, {
        code: 'missing-file',
        message:
          'Cloudflare output is missing worker/package.json for referenced worker bundles.',
        path: workerPackagePath,
      });
    }

    if (
      manifest.bff?.runtimeFramework === 'effect' &&
      !getEffectBffWorker(manifest)
    ) {
      addIssue(issues, {
        code: 'missing-worker-bundle',
        message:
          'Cloudflare Effect BFF manifest points to a missing worker bundle.',
      });
    }

    for (const workerReference of workerReferences) {
      const resolvedWorker = resolveWorkerBundleReference(
        issues,
        outputDirectory,
        workerReference,
        manifestPath,
      );
      if (!resolvedWorker) {
        continue;
      }

      const workerExists = await pathExists(resolvedWorker.path);
      if (!workerExists) {
        addIssue(issues, {
          code: 'missing-worker-bundle',
          message: missingWorkerBundleMessage(workerReference),
          path: resolvedWorker.path,
        });
      }

      if (workerExists && resolvedWorker.kind === 'effect-bff') {
        const workerSource = await fs.readFile(resolvedWorker.path, 'utf-8');
        if (
          workerSource.includes(';entityKind;') ||
          workerSource.includes(';entityKind,entityKind;')
        ) {
          addIssue(issues, {
            code: 'invalid-worker-bundle',
            message:
              'Cloudflare Effect BFF worker bundle contains invalid Drizzle entityKind marker references.',
            path: resolvedWorker.path,
          });
        }
      }
    }
  }

  if (wrangler) {
    assertEqual(issues, wrangler.main, outputPlan.wrangler.main, {
      code: 'invalid-wrangler',
      message: `wrangler.json main must be ${outputPlan.wrangler.main}.`,
      path: wranglerPath,
    });
    assertEqual(
      issues,
      wrangler.assets?.binding,
      outputPlan.wrangler.assets.binding,
      {
        code: 'invalid-wrangler',
        message: 'wrangler.json assets.binding must be ASSETS.',
        path: wranglerPath,
      },
    );
    assertEqual(
      issues,
      wrangler.assets?.directory,
      outputPlan.wrangler.assets.directory,
      {
        code: 'invalid-wrangler',
        message: 'wrangler.json assets.directory must be ./public.',
        path: wranglerPath,
      },
    );
    assertEqual(
      issues,
      wrangler.assets?.run_worker_first,
      outputPlan.wrangler.assets.run_worker_first,
      {
        code: 'invalid-wrangler',
        message: 'wrangler.json assets.run_worker_first must be true.',
        path: wranglerPath,
      },
    );
    for (const flag of outputPlan.wrangler.requiredCompatibilityFlags) {
      assertFlag(issues, wrangler.compatibility_flags, flag, {
        code: 'invalid-wrangler',
        message: `wrangler.json compatibility_flags must include ${flag}.`,
        path: wranglerPath,
      });
    }
  }

  if (outputPackage) {
    assertEqual(issues, outputPackage.type, outputPlan.packages.output.type, {
      code: 'invalid-package',
      message: '.output/package.json must declare type module.',
      path: packagePath,
    });
  }

  if (workerPackage) {
    assertEqual(issues, workerPackage.type, outputPlan.packages.worker.type, {
      code: 'invalid-package',
      message: '.output/worker/package.json must declare type commonjs.',
      path: workerPackagePath,
    });
  }

  for (const leakedPath of outputPlan.publicLeakDirectories) {
    const publicPath = path.join(outputPlan.paths.publicAssets, leakedPath);
    if (await pathExists(publicPath)) {
      addIssue(issues, {
        code: 'public-output-leak',
        message: `Framework-owned ${leakedPath} output leaked into public assets.`,
        path: publicPath,
      });
    }
  }

  if (
    options.importWorker !== false &&
    (await pathExists(outputPlan.paths.workerEntry))
  ) {
    await verifyWorkerImport(issues, outputPlan.paths.workerEntry);
  }

  return {
    ok: issues.length === 0,
    issues,
  };
};

export const assertCloudflareOutput = async (
  options: VerifyCloudflareOutputOptions,
) => {
  const result = await verifyCloudflareOutput(options);

  if (!result.ok) {
    throw new Error(
      [
        'Cloudflare output verification failed:',
        ...result.issues.map(
          issue =>
            `- ${issue.code}: ${issue.message}${issue.path ? ` (${issue.path})` : ''}`,
        ),
      ].join('\n'),
    );
  }
};
