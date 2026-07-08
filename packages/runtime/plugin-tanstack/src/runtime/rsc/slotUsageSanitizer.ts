// @effect-diagnostics strictBooleanExpressions:off
import { isValidElement } from 'react';
import type { SerializableSlotArg } from './symbols';

const REACT_ELEMENT_TYPE = Symbol.for('react.element');
const REACT_PORTAL_TYPE = Symbol.for('react.portal');
const REACT_TRANSITIONAL_ELEMENT_TYPE = Symbol.for(
  'react.transitional.element',
);

function isReactElementLike(value: unknown) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }

  if (isValidElement(value)) {
    return true;
  }

  const type = (value as { $$typeof?: unknown }).$$typeof;
  return (
    type === REACT_ELEMENT_TYPE ||
    type === REACT_TRANSITIONAL_ELEMENT_TYPE ||
    type === REACT_PORTAL_TYPE
  );
}

function sanitizeSlotArg(
  value: unknown,
  seen: WeakSet<object>,
): SerializableSlotArg {
  if (isReactElementLike(value)) {
    return 'React element';
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value;
  }

  if (typeof value !== 'object' && typeof value !== 'function') {
    return String(value);
  }

  if (typeof value === 'function') {
    return '[Function]';
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map(item => sanitizeSlotArg(item, seen));
  }

  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) {
    const out: Record<string, SerializableSlotArg> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = sanitizeSlotArg(item, seen);
    }
    return out;
  }

  return String(value);
}

export function sanitizeSlotArgs(args: unknown[]) {
  const seen = new WeakSet<object>();
  return args.map(arg => sanitizeSlotArg(arg, seen));
}
