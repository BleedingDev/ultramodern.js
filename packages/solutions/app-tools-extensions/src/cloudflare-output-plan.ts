import path from 'node:path';
import {
  CLOUDFLARE_ASSETS_BINDING,
  CLOUDFLARE_OUTPUT_PACKAGE_FILE,
  CLOUDFLARE_OUTPUT_PACKAGE_TYPE,
  CLOUDFLARE_PUBLIC_ASSETS_DIRECTORY,
  CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS,
  CLOUDFLARE_WORKER_BUNDLE_DIRECTORY,
  CLOUDFLARE_WORKER_ENTRY,
  CLOUDFLARE_WORKER_MANIFEST,
  CLOUDFLARE_WORKER_PACKAGE_FILE,
  CLOUDFLARE_WORKER_PACKAGE_TYPE,
  CLOUDFLARE_WRANGLER_CONFIG_FILE,
} from './cloudflare-output-contract';

type CloudflareOutputPlan = {
  outputDirectory: string;
  requiredFiles: string[];
  publicLeakDirectories: string[];
  paths: {
    workerEntry: string;
    workerManifest: string;
    wranglerConfig: string;
    outputPackage: string;
    workerPackage: string;
    publicAssets: string;
    workerBundle: string;
  };
  packages: {
    output: {
      type: typeof CLOUDFLARE_OUTPUT_PACKAGE_TYPE;
    };
    worker: {
      type: typeof CLOUDFLARE_WORKER_PACKAGE_TYPE;
    };
  };
  wrangler: {
    main: typeof CLOUDFLARE_WORKER_ENTRY;
    assets: {
      binding: typeof CLOUDFLARE_ASSETS_BINDING;
      directory: `./${typeof CLOUDFLARE_PUBLIC_ASSETS_DIRECTORY}`;
      run_worker_first: true;
    };
    requiredCompatibilityFlags: typeof CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS;
  };
};

const resolveOutput = (outputDirectory: string, relativePath: string) =>
  path.join(outputDirectory, relativePath);

export function createCloudflareOutputPlan(
  outputDirectory: string,
): CloudflareOutputPlan {
  return {
    outputDirectory,
    requiredFiles: [
      CLOUDFLARE_WORKER_ENTRY,
      CLOUDFLARE_WORKER_MANIFEST,
      CLOUDFLARE_WRANGLER_CONFIG_FILE,
      CLOUDFLARE_OUTPUT_PACKAGE_FILE,
    ],
    publicLeakDirectories: ['server', CLOUDFLARE_WORKER_BUNDLE_DIRECTORY],
    paths: {
      workerEntry: resolveOutput(outputDirectory, CLOUDFLARE_WORKER_ENTRY),
      workerManifest: resolveOutput(
        outputDirectory,
        CLOUDFLARE_WORKER_MANIFEST,
      ),
      wranglerConfig: resolveOutput(
        outputDirectory,
        CLOUDFLARE_WRANGLER_CONFIG_FILE,
      ),
      outputPackage: resolveOutput(
        outputDirectory,
        CLOUDFLARE_OUTPUT_PACKAGE_FILE,
      ),
      workerPackage: resolveOutput(
        outputDirectory,
        CLOUDFLARE_WORKER_PACKAGE_FILE,
      ),
      publicAssets: resolveOutput(
        outputDirectory,
        CLOUDFLARE_PUBLIC_ASSETS_DIRECTORY,
      ),
      workerBundle: resolveOutput(
        outputDirectory,
        CLOUDFLARE_WORKER_BUNDLE_DIRECTORY,
      ),
    },
    packages: {
      output: {
        type: CLOUDFLARE_OUTPUT_PACKAGE_TYPE,
      },
      worker: {
        type: CLOUDFLARE_WORKER_PACKAGE_TYPE,
      },
    },
    wrangler: {
      main: CLOUDFLARE_WORKER_ENTRY,
      assets: {
        binding: CLOUDFLARE_ASSETS_BINDING,
        directory: `./${CLOUDFLARE_PUBLIC_ASSETS_DIRECTORY}`,
        run_worker_first: true,
      },
      requiredCompatibilityFlags: CLOUDFLARE_REQUIRED_COMPATIBILITY_FLAGS,
    },
  };
}
