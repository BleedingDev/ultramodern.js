// @effect-diagnostics asyncFunction:off globalDate:off globalRandom:off globalTimers:off newPromise:off strictBooleanExpressions:off
import { buildScopeKey, createOperationId, sanitizeSegment } from './codec';
import type {
  CacheScope,
  InvalidationEvent,
  InvalidationSubscriber,
  OperationDescriptor,
} from './types';

export function createInvalidationEvent(input: {
  sourceOperation: OperationDescriptor;
  sourceScope: CacheScope;
  targetNamespaces?: string[];
  targetOperations?: OperationDescriptor[];
}): InvalidationEvent {
  return {
    sourceNamespace: sanitizeSegment(input.sourceOperation.appNamespace),
    sourceOperationId: createOperationId(input.sourceOperation),
    scopeKey: buildScopeKey(input.sourceScope),
    targetNamespaces: input.targetNamespaces?.map(namespace =>
      sanitizeSegment(namespace),
    ),
    targetOperationIds: input.targetOperations?.map(operation =>
      createOperationId(operation),
    ),
  };
}

export function shouldApplyInvalidation(
  event: InvalidationEvent,
  subscriber: InvalidationSubscriber,
): boolean {
  if (subscriber.scopeKey && subscriber.scopeKey !== event.scopeKey) {
    return false;
  }

  const sameNamespace = subscriber.namespace === event.sourceNamespace;
  const allowedCrossNamespace =
    subscriber.acceptCrossNamespace === true &&
    event.targetNamespaces?.includes(subscriber.namespace) === true;

  if (!sameNamespace && !allowedCrossNamespace) {
    return false;
  }

  if (!subscriber.operationIds || subscriber.operationIds.length === 0) {
    return true;
  }

  if (!event.targetOperationIds || event.targetOperationIds.length === 0) {
    return true;
  }

  return subscriber.operationIds.some(operationId =>
    event.targetOperationIds?.includes(operationId),
  );
}
