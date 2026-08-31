// @effect-diagnostics asyncFunction:off globalDate:off globalRandom:off globalTimers:off newPromise:off strictBooleanExpressions:off
import { isPlainObject } from '../codec';
import type { DataBatchResponseItem, DataBatchResponsePayload } from '../types';
import { isBatchBody, isBatchHeaderList, isNullBodyStatus } from './protocol';

function isBatchResponseItem(value: unknown): value is DataBatchResponseItem {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.status === 'number' &&
    (typeof value.headers === 'undefined' ||
      isBatchHeaderList(value.headers)) &&
    (typeof value.body === 'undefined' || isBatchBody(value.body)) &&
    !(isNullBodyStatus(value.status) && typeof value.body !== 'undefined')
  );
}

export function isBatchResponsePayload(
  value: unknown,
): value is DataBatchResponsePayload {
  return (
    isPlainObject(value) &&
    value.protocolVersion === 2 &&
    typeof value.batchId === 'string' &&
    typeof value.receivedAt === 'number' &&
    Array.isArray(value.items) &&
    value.items.every(item => isBatchResponseItem(item))
  );
}

export async function parseResponseLikeCreateRequest(response: Response) {
  const contentType = (
    response.headers.get('content-type') || ''
  ).toLowerCase();

  if (!response.ok) {
    let data: unknown = null;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    (response as Response & { data?: unknown }).data = data;
    throw response;
  }

  if (
    contentType.includes('application/json') ||
    contentType.includes('text/json')
  ) {
    return response.json();
  }

  if (contentType.includes('text/html') || contentType.includes('text/plain')) {
    return response.text();
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    return response.formData();
  }

  if (contentType.includes('application/octet-stream')) {
    return response.arrayBuffer();
  }

  if (contentType.includes('image/png')) {
    return response;
  }

  return response.text();
}
