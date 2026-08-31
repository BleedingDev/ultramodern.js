// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off processEnv:off strictBooleanExpressions:off
import { type GenClientOptions, generateClient } from '@modern-js/bff-core';
import type { HttpMethodDecider } from '@modern-js/types';
import { fs, logger } from '@modern-js/utils';
import path from 'path';
import type { GeneratedEffectClientArtifacts } from '../effect-client-generator/types';
import {
  generateEffectClient,
  resolveEffectEntryFile,
} from '../effectClientGenerator';
import {
  CLIENT_DIR,
  createFileDetails,
  type FileDetails,
  readDirectoryFiles,
  writeTargetFile,
} from './files';
import { getPackageName } from './package-json';
import {
  buildClientTypeFacade,
  createMissingClientDeclarationError,
  DEFAULT_EXPORT_RE,
  isMissingClientDeclarationError,
} from './type-facade';
import { setPackage, writeClientModuleBoundary } from './write-package';

export type APILoaderOptions = {
  prefix: string;
  appDir: string;
  apiDir: string;
  lambdaDir: string;
  existLambda: boolean;
  port?: number;
  requestCreator?: string;
  httpMethodDecider?: HttpMethodDecider;
  relativeDistPath: string;
  relativeApiPath: string;
  requestId?: string;
  /**
   * Absolute paths of the valid API files, resolved by ApiRouter with the same
   * `API_FILE_RULES` the runtime router uses. Passing them in keeps the client
   * generator and the router in agreement about what an API module is, so
   * stray artifacts next to the sources (compiled `.d.ts`/`.js`, tests,
   * private files) never reach `generateClient`.
   */
  apiFiles: string[];
  bffRuntimeFramework?: 'hono' | 'effect';
  effectEntry?: string;
  effectDataPlatformBatch?: {
    enabled?: boolean;
    endpoint?: string;
    flushIntervalMs?: number;
    maxBatchSize?: number;
    maxBatchBytes?: number;
    requestTimeoutMs?: number;
    allowedMethods?: string[];
  };
};

export async function clientGenerator(draftOptions: APILoaderOptions) {
  const generatedClientDir = path.resolve(
    draftOptions.appDir,
    draftOptions.relativeDistPath,
    CLIENT_DIR,
  );
  await fs.remove(generatedClientDir);
  const requestId =
    getPackageName(draftOptions.appDir) || process.env.npm_package_name;

  const lambdaSourceList = draftOptions.existLambda
    ? await readDirectoryFiles(
        draftOptions.appDir,
        draftOptions.lambdaDir,
        draftOptions.relativeDistPath,
        draftOptions.apiFiles,
      )
    : [];
  const generatedSourceList = [...lambdaSourceList];
  let generatedEffectClient: GeneratedEffectClientArtifacts | null = null;

  const getClitentCode = async (resourcePath: string, source: string) => {
    const warning = `The file ${resourcePath} is not allowed to be imported in src directory, only API definition files are allowed.`;

    if (!draftOptions.existLambda) {
      logger.warn(warning);
      return;
    }

    const options: GenClientOptions = {
      prefix: (Array.isArray(draftOptions.prefix)
        ? draftOptions.prefix[0]
        : draftOptions.prefix) as string,
      appDir: draftOptions.appDir,
      apiDir: draftOptions.apiDir,
      lambdaDir: draftOptions.lambdaDir,
      port: Number(draftOptions.port),
      source,
      resourcePath,
      target: 'bundle',
      httpMethodDecider: draftOptions.httpMethodDecider,
      requestCreator: draftOptions.requestCreator,
      requestId,
    };

    const { lambdaDir } = draftOptions;
    if (!resourcePath.startsWith(lambdaDir)) {
      logger.warn(warning);
      return;
    }

    const result = await generateClient(options);

    return result;
  };

  // The generated client directory always carries `{"type": "module"}` (see
  // writeClientModuleBoundary), so its declarations are native ESM whatever the
  // surrounding app's moduleType is, and their re-export specifiers always need
  // the explicit `.js` extension. Deriving this from the app-level moduleType
  // — as upstream's cli.ts does — would emit extensionless specifiers into an
  // ESM package and break node16/nodenext consumers with TS2835.
  const writeClientTypeFacade = async (
    source: FileDetails,
    clientCode: string,
  ) => {
    if (!(await fs.pathExists(path.resolve(source.relativeTargetDistDir)))) {
      throw createMissingClientDeclarationError(
        source.resourcePath,
        source.relativeTargetDistDir,
      );
    }

    const clientTypesFile = source.targetDir.replace(/\.js$/, '.d.ts');
    await writeTargetFile(
      path.resolve(clientTypesFile),
      buildClientTypeFacade(
        clientTypesFile,
        source.relativeTargetDistDir,
        DEFAULT_EXPORT_RE.test(clientCode),
        true,
      ),
    );
  };

  try {
    for (const source of lambdaSourceList) {
      const code = await getClitentCode(source.resourcePath, source.source);
      if (code?.value) {
        await writeTargetFile(source.absTargetDir, code.value);
        await writeClientTypeFacade(source, code.value);
      }
    }

    if (draftOptions.bffRuntimeFramework === 'effect') {
      const effectEntryFile = resolveEffectEntryFile({
        appDir: draftOptions.appDir,
        apiDir: draftOptions.apiDir,
        effectEntry: draftOptions.effectEntry,
      });

      if (effectEntryFile) {
        const effectSource = await fs.readFile(effectEntryFile, 'utf8');
        const effectFileDetails = createFileDetails({
          appDirectory: draftOptions.appDir,
          baseDirectory: draftOptions.apiDir,
          resourcePath: effectEntryFile,
          source: effectSource,
          relativeDistPath: draftOptions.relativeDistPath,
        });

        generatedEffectClient = await generateEffectClient({
          appDir: draftOptions.appDir,
          apiDir: draftOptions.apiDir,
          resourcePath: effectEntryFile,
          prefix: (Array.isArray(draftOptions.prefix)
            ? draftOptions.prefix[0]
            : draftOptions.prefix) as string,
          port: Number(draftOptions.port),
          target: 'bundle',
          requestId: draftOptions.requestId,
          requestCreator: draftOptions.requestCreator,
          httpMethodDecider: draftOptions.httpMethodDecider,
          dataPlatformBatch: draftOptions.effectDataPlatformBatch,
        });

        if (generatedEffectClient) {
          const targetTypeFile = effectFileDetails.targetDir.replace(
            /\.js$/,
            '.d.ts',
          );

          await writeTargetFile(
            effectFileDetails.absTargetDir,
            generatedEffectClient.code,
          );
          await writeTargetFile(
            path.resolve(targetTypeFile),
            generatedEffectClient.declaration,
          );
          generatedSourceList.push(effectFileDetails);
        }
      }
    }

    logger.info(`Client bundle generate succeed`);
  } catch (error) {
    // A missing handler declaration silently published a broken type surface,
    // which is exactly the defect this generator now guards; it must not be
    // downgraded to a log line by the surrounding best-effort handler.
    if (isMissingClientDeclarationError(error)) {
      throw error;
    }
    logger.error(`Client bundle generate failed: ${error}`);
  }

  if (generatedSourceList.length > 0) {
    await writeClientModuleBoundary(
      draftOptions.appDir,
      draftOptions.relativeDistPath,
    );
  }

  await setPackage(
    generatedSourceList,
    draftOptions.appDir,
    draftOptions.relativeDistPath,
  );

  return generatedEffectClient;
}

export default clientGenerator;
