// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off processEnv:off strictBooleanExpressions:off

export type { FileDetails } from './files';
export {
  createFileDetails,
  readDirectoryFiles,
  writeTargetFile,
} from './files';
export type { APILoaderOptions } from './generate';
export { clientGenerator, default } from './generate';
export type { PackageJsonLike } from './package-json';
export {
  getClientPackageName,
  getPackageName,
  mergePackageJson,
} from './package-json';
export {
  buildClientTypeFacade,
  MissingClientDeclarationError,
} from './type-facade';
export { setPackage, writeClientModuleBoundary } from './write-package';
