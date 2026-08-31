import path from 'node:path';
import { fs as fse } from '@modern-js/utils';
import {
  emitCloudflareStagedReleaseEnvelope,
  emitFrameworkMicroVerticalReleaseEnvelope,
  MICROVERTICAL_RELEASE_ENVELOPE_PATH,
  stageCloudflareReleaseEnvelope,
  verifyBuildOutputReleaseEnvelope,
  verifyCloudflareReleaseEnvelopeStaging,
} from '../../../../ultramodern-release-envelope/framework-output';
import { readTemplate } from '../../utils';
import { createCloudflareOutputPlan } from '../cloudflare-output-plan';
import { assertCloudflareOutput } from '../cloudflare-output-verifier/index';
import type { CreatePreset } from '../platform';
import {
  copyCloudflareArtifacts,
  copyCloudflareD1Migrations,
  copyCloudflarePublicAssets,
  getCloudflareArtifacts,
  getCloudflarePublicAssets,
} from './artifacts';
import {
  ROUTE_SPEC_FILE,
  ROUTE_SPEC_OUTPUT,
  WORKER_BUNDLE_DIRECTORY,
  WORKER_ENTRY,
  WORKER_MANIFEST,
  WRANGLER_CONFIG_FILE,
} from './constants';
import {
  resolveTopologyDeliveryUnit,
  resolveWorkerDeliveryUnitStamp,
} from './delivery-unit';
import {
  createWorkerManifest,
  createWorkerModuleLoaders,
  getPublicAssetExcludes,
  shouldCopyToPublicAssets,
  shouldCopyToWorkerBundle,
} from './worker-manifest';
import { createWranglerConfig } from './wrangler-config';

const CLOUDFLARE_ENTRY_TEMPLATE_FRAGMENTS = [
  'cloudflare-entry.001-bootstrap-security.mjs',
  'cloudflare-entry.002-assets-routes.mjs',
  'cloudflare-entry.003-i18n-locales.mjs',
  'cloudflare-entry.004-rendering-css.mjs',
  'cloudflare-entry.005-worker-dispatch.mjs',
  'cloudflare-entry.006-fetch-handler.mjs',
] as const;

/**
 * The Cloudflare entry is emitted as a raw module worker, not bundled by
 * app-tools. Keep worker-runtime helpers inline unless the helper is emitted
 * into `.output` or provided by a generated-worker dependency. Concatenate
 * fragments without separators so existing generated output stays byte-identical.
 */
const readCloudflareEntryTemplate = async () =>
  (
    await Promise.all(
      CLOUDFLARE_ENTRY_TEMPLATE_FRAGMENTS.map(fragment =>
        readTemplate(fragment),
      ),
    )
  ).join('');

export const createCloudflarePreset: CreatePreset = ({
  api,
  appContext,
  modernConfig,
}) => {
  const { apiOnly, appDirectory, distDirectory } = appContext;

  const outputDirectory = path.join(appDirectory, '.output');
  const outputPlan = createCloudflareOutputPlan(outputDirectory);
  const publicDirectory = outputPlan.paths.publicAssets;
  const workerEntryPath = outputPlan.paths.workerEntry;
  const workerManifestPath = outputPlan.paths.workerManifest;
  const routeSpecOutputPath = path.join(outputDirectory, ROUTE_SPEC_OUTPUT);
  const wranglerConfigPath = outputPlan.paths.wranglerConfig;
  const cloudflareArtifacts = getCloudflareArtifacts(modernConfig);
  const publicAssetExcludes = getPublicAssetExcludes(
    appDirectory,
    modernConfig,
  );
  const releaseEnvelopeEnabled = api.isPluginExists(
    '@modern-js/ultramodern-release-envelope',
  );
  let hasReleaseEnvelope = false;

  return {
    async prepare() {
      await fse.remove(outputDirectory);
    },
    async writeOutput() {
      if (
        releaseEnvelopeEnabled &&
        (await fse.pathExists(
          path.join(distDirectory, MICROVERTICAL_RELEASE_ENVELOPE_PATH),
        ))
      ) {
        await emitFrameworkMicroVerticalReleaseEnvelope({
          apiOnly,
          distDirectory,
          target: 'cloudflare',
        });
      }
      if (releaseEnvelopeEnabled) {
        await verifyBuildOutputReleaseEnvelope(distDirectory, 'cloudflare');
      }
      await fse.copy(distDirectory, publicDirectory, {
        filter: src => {
          const relativePath = path
            .relative(distDirectory, src)
            .replace(/\\/gu, '/');
          return (
            relativePath !== 'release' &&
            !relativePath.startsWith('release/') &&
            relativePath !== 'public' &&
            !relativePath.startsWith('public/') &&
            shouldCopyToPublicAssets(src, distDirectory, publicAssetExcludes)
          );
        },
      });
      const generatedPublicDirectory = path.join(distDirectory, 'public');
      if (await fse.pathExists(generatedPublicDirectory)) {
        await fse.copy(generatedPublicDirectory, publicDirectory, {
          filter: src => {
            const relativePath = path
              .relative(generatedPublicDirectory, src)
              .replace(/\\/gu, '/');
            return (
              relativePath !== 'release' &&
              !relativePath.startsWith('release/') &&
              shouldCopyToPublicAssets(
                src,
                generatedPublicDirectory,
                publicAssetExcludes,
              )
            );
          },
        });
      }
      await fse.ensureDir(path.dirname(workerEntryPath));
      await fse.ensureDir(path.dirname(workerManifestPath));

      const routeSpecSourcePath = path.join(distDirectory, ROUTE_SPEC_FILE);
      if (await fse.pathExists(routeSpecSourcePath)) {
        await fse.copy(routeSpecSourcePath, routeSpecOutputPath);
      }

      const workerBundleSourceDirectory = path.join(
        distDirectory,
        WORKER_BUNDLE_DIRECTORY,
      );
      const workerBundleOutputDirectory = outputPlan.paths.workerBundle;
      if (await fse.pathExists(workerBundleSourceDirectory)) {
        await fse.copy(
          workerBundleSourceDirectory,
          workerBundleOutputDirectory,
          {
            filter: src =>
              shouldCopyToWorkerBundle(src, workerBundleSourceDirectory),
          },
        );
        await fse.writeJSON(
          outputPlan.paths.workerPackage,
          outputPlan.packages.worker,
        );
      }
      await copyCloudflareArtifacts(
        appDirectory,
        outputDirectory,
        cloudflareArtifacts,
      );
      await copyCloudflarePublicAssets(
        appDirectory,
        publicDirectory,
        getCloudflarePublicAssets(modernConfig),
      );
      await copyCloudflareD1Migrations(
        appDirectory,
        outputDirectory,
        modernConfig,
      );

      await fse.writeJSON(
        wranglerConfigPath,
        createWranglerConfig(appDirectory, modernConfig),
        {
          spaces: 2,
        },
      );

      const deliveryUnitStamp =
        await resolveWorkerDeliveryUnitStamp(appDirectory);
      await fse.writeJSON(
        workerManifestPath,
        await createWorkerManifest(
          outputDirectory,
          modernConfig,
          appContext,
          deliveryUnitStamp,
        ),
        {
          spaces: 2,
        },
      );
      await fse.writeJSON(
        outputPlan.paths.outputPackage,
        outputPlan.packages.output,
      );
      hasReleaseEnvelope =
        releaseEnvelopeEnabled &&
        Boolean(
          await stageCloudflareReleaseEnvelope({
            distDirectory,
            outputDirectory,
          }),
        );
    },
    async genEntry() {
      const template = await readCloudflareEntryTemplate();
      const manifest = await fse.readJSON(workerManifestPath);

      await fse.writeFile(
        workerEntryPath,
        template
          .replace('p_workerManifest', JSON.stringify(manifest, null, 2))
          .replace(
            'p_workerModuleLoaders',
            createWorkerModuleLoaders(manifest),
          ),
      );
      const topologyDeliveryUnit =
        await resolveTopologyDeliveryUnit(appDirectory);
      await assertCloudflareOutput({
        outputDirectory,
        importWorker: false,
        ...(topologyDeliveryUnit ? { deliveryUnit: topologyDeliveryUnit } : {}),
      });
      if (hasReleaseEnvelope) {
        await emitCloudflareStagedReleaseEnvelope({
          distDirectory,
          outputDirectory,
        });
        await verifyCloudflareReleaseEnvelopeStaging(outputDirectory);
      } else if (
        await fse.pathExists(
          path.join(outputDirectory, MICROVERTICAL_RELEASE_ENVELOPE_PATH),
        )
      ) {
        throw new Error(
          '[ultramodern-release-envelope] Cloudflare staging contains an envelope not selected from this MicroVertical build.',
        );
      }
    },
  };
};
