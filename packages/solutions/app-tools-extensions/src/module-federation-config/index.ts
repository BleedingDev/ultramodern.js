export {
  readModuleFederationConfigInspection,
  readModuleFederationExposePaths,
} from './exposes';
export { inspectModuleFederationConfigSource } from './inspect';
export {
  parseArrayLiteral,
  parseLiteralString,
  parseObjectLiteral,
} from './object-literal';
export {
  findCreateModuleFederationConfigObject,
  findExportDefaultObject,
  locateCreateModuleFederationConfigObject,
  parseConfigModule,
  parseStaticExpression,
} from './syntax';
export type {
  LocatedObjectLiteral,
  ModuleFederationConfigInspection,
  ParsedObjectLiteral,
} from './types';
