import { createHash } from 'crypto';
import type { APIHandlerInfo } from '../router/types';

export type OperationContractEntry = {
  name: string;
  httpMethod: string;
  routePath: string;
};

export type OperationContractDefinition = {
  requestId: string;
  operationVersion: number;
  schemaHash: string;
  method: string;
  routePath: string;
  operationId: string;
  handlerName: string;
  filename?: string;
};

export type OperationContractMap = Record<string, OperationContractDefinition>;

export const DEFAULT_OPERATION_VERSION = 1;

type ModuleOperationEntry = OperationContractEntry & {
  filename?: string;
};

export const createOperationEntries = (
  handlers: Array<{
    name: string;
    httpMethod: string;
    routePath: string;
  }>,
): OperationContractEntry[] =>
  handlers
    .map(item => ({
      name: item.name,
      httpMethod: String(item.httpMethod || '').toUpperCase(),
      routePath: item.routePath,
    }))
    .sort((a, b) => {
      const keyA = `${a.routePath}:${a.httpMethod}:${a.name}`;
      const keyB = `${b.routePath}:${b.httpMethod}:${b.name}`;
      return keyA.localeCompare(keyB);
    });

export const createOperationSchemaHash = (
  operationEntries: OperationContractEntry[],
  requestId: string,
) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        operations: operationEntries.map(item => ({
          name: item.name,
          httpMethod: item.httpMethod,
          routePath: item.routePath,
        })),
        requestId,
      }),
    )
    .digest('hex');

export const buildOperationContractMap = ({
  handlers,
  requestId,
}: {
  handlers: APIHandlerInfo[];
  requestId?: string;
}): OperationContractMap => {
  const normalizedRequestId =
    typeof requestId === 'string' && requestId.trim().length > 0
      ? requestId.trim()
      : 'default';

  const byModule = new Map<string, ModuleOperationEntry[]>();
  handlers.forEach(item => {
    const moduleId =
      typeof item.filename === 'string' && item.filename.length > 0
        ? item.filename
        : '__anonymous__';
    const group = byModule.get(moduleId) || [];
    group.push({
      name: item.name,
      httpMethod: item.httpMethod.toUpperCase(),
      routePath: item.routePath,
      filename: item.filename,
    });
    byModule.set(moduleId, group);
  });

  const contracts: OperationContractMap = {};
  byModule.forEach(moduleEntries => {
    const entries = createOperationEntries(moduleEntries);
    const schemaHash = createOperationSchemaHash(entries, normalizedRequestId);
    const filename = moduleEntries[0]?.filename;
    entries.forEach(entry => {
      const operationId = `${normalizedRequestId}:${entry.name}`;
      const contract: OperationContractDefinition = {
        requestId: normalizedRequestId,
        operationVersion: DEFAULT_OPERATION_VERSION,
        schemaHash,
        method: entry.httpMethod,
        routePath: entry.routePath,
        operationId,
        handlerName: entry.name,
        filename,
      };
      contracts[`${entry.httpMethod}:${entry.routePath}`] = contract;
      contracts[`operation:${operationId}`] = contract;
    });
  });

  return contracts;
};
