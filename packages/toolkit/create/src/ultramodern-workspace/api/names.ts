import { resolveApiStem } from '../descriptors';
import { toCamelCase, toPascalCase } from '../naming';
import type { WorkspaceApi } from '../types';

export function verticalApiExport(service: { id: string; api?: WorkspaceApi }) {
  return `${toCamelCase(resolveApiStem(service))}Api`;
}

export function verticalApiGroupName(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return toCamelCase(resolveApiStem(service));
}

export function verticalApiName(service: { id: string; api?: WorkspaceApi }) {
  return `${toPascalCase(resolveApiStem(service))}Api`;
}

export function verticalApiSchemaExport(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return `${toCamelCase(resolveApiStem(service))}ItemSchema`;
}

export function verticalApiMarkerSchemaExport(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return `${toCamelCase(resolveApiStem(service))}MarkerSchema`;
}

export function verticalApiReadinessSchemaExport(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return `${toCamelCase(resolveApiStem(service))}ReadinessSchema`;
}

export function verticalApiErrorStem(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return resolveApiStem(service);
}

export function verticalApiCreatePayloadSchemaExport(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return `${toCamelCase(resolveApiStem(service))}CreatePayloadSchema`;
}

export function verticalApiNotFoundErrorExport(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return `${toPascalCase(verticalApiErrorStem(service))}NotFound`;
}

export function verticalApiNotFoundSchemaExport(service: {
  id: string;
  api?: WorkspaceApi;
}) {
  return `${toCamelCase(verticalApiErrorStem(service))}NotFoundSchema`;
}
