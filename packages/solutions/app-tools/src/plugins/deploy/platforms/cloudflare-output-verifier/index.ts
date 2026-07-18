import fs from 'node:fs/promises';
import path from 'node:path';
import { createCloudflareOutputPlan } from '../cloudflare-output-plan';
import type { CloudflareDeliveryUnitIdentity } from './identity';
import { verifyDeliveryUnitIdentity } from './identity';
import type {
  CloudflareOutputVerifierIssue,
  CloudflareOutputVerifierResult,
  JsonObject,
} from './issues';
import { addIssue, assertEqual, assertFlag } from './issues';
import { verifyManifestShape } from './manifest';
import {
  getEffectBffWorker,
  getWorkerBundleReferences,
  missingWorkerBundleMessage,
  resolveWorkerBundleReference,
  verifyWorkerBundleReferences,
  verifyWorkerImport,
} from './worker-bundles';

export type { CloudflareDeliveryUnitIdentity } from './identity';
export type {
  CloudflareOutputVerifierIssue,
  CloudflareOutputVerifierIssueCode,
  CloudflareOutputVerifierResult,
} from './issues';
export {
  type VerifyCloudflareOutputMutationPolicyOptions,
  verifyCloudflareOutputMutationPolicy,
} from './mutation-policy';

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
    const providedWorkerPackages = new Set(
      workerPackage?.dependencies &&
        typeof workerPackage.dependencies === 'object'
        ? Object.keys(workerPackage.dependencies)
        : [],
    );
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

      if (workerExists) {
        const workerSource = await fs.readFile(resolvedWorker.path, 'utf-8');
        await verifyWorkerBundleReferences(
          issues,
          resolvedWorker,
          workerSource,
          {
            providedPackages: providedWorkerPackages,
            workerRoot: outputPlan.paths.workerBundle,
          },
        );
        if (
          resolvedWorker.kind === 'effect-bff' &&
          (workerSource.includes(';entityKind;') ||
            workerSource.includes(';entityKind,entityKind;'))
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
