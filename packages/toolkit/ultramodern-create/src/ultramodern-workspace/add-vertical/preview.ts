import { isDeepStrictEqual } from 'node:util';
import type { JsonValue, UltramodernJsonMutation } from '../types';
import type { WorkspaceChange } from './transaction';

/** Describe the prepared bytes, so preview cannot invent writes that apply omits. */
export function describeJsonChanges(
  changes: readonly WorkspaceChange[],
): UltramodernJsonMutation[] {
  const mutations: UltramodernJsonMutation[] = [];
  for (const change of changes) {
    if (
      !change.relativePath.endsWith('.json') ||
      change.before?.symlink ||
      change.after?.symlink
    )
      continue;
    let before: JsonValue | undefined;
    let after: JsonValue | undefined;
    try {
      before = change.before && JSON.parse(change.before.content.toString());
      after = change.after && JSON.parse(change.after.content.toString());
    } catch {
      // Authored JSON-like files may contain comments; their file change still
      // appears in createdPaths/rewrittenPaths without a misleading JSON claim.
      continue;
    }
    const visit = (
      previous: JsonValue | undefined,
      next: JsonValue | undefined,
      pointer: string,
    ) => {
      if (isDeepStrictEqual(previous, next)) return;
      if (
        Array.isArray(previous) &&
        Array.isArray(next) &&
        previous.every((value, index) =>
          isDeepStrictEqual(value, next[index]),
        ) &&
        next.length >= previous.length
      ) {
        for (const value of next.slice(previous.length))
          visit(undefined, value, `${pointer}/-`);
        return;
      }
      if (
        previous &&
        next &&
        typeof previous === 'object' &&
        typeof next === 'object' &&
        !Array.isArray(previous) &&
        !Array.isArray(next)
      ) {
        for (const key of new Set([
          ...Object.keys(previous),
          ...Object.keys(next),
        ])) {
          visit(
            previous[key],
            next[key],
            `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
          );
        }
        return;
      }
      mutations.push({
        path: change.relativePath,
        pointer,
        description: `${next === undefined ? 'Remove' : previous === undefined ? 'Add' : 'Update'} ${pointer || 'document'}`,
        ...(next === undefined ? {} : { value: next }),
      });
    };
    visit(before, after, '');
  }
  return mutations;
}
