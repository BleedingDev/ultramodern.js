import path from 'node:path';
import type {
  ConfigSourceSnapshot,
  ObservedConfigSourceInputs,
} from '@modern-js/ultramodern-app-tools/config-evaluator';
import { assertConsumedConfigInputsUnchanged } from './config-consumed-inputs';

export type WorkspaceSourceReadObserver = (
  input: string,
  operation: 'content' | 'entry-kind',
  existed: boolean,
) => void;

/** Declarative readers retain their native results and the original baseline. */
export function trackWorkspacePublicationInputs(
  workspaceRoot: string,
  sourceSnapshot: ConfigSourceSnapshot,
) {
  const observations: ObservedConfigSourceInputs['observations'][number][] = [];
  const originalStates = new Map(
    sourceSnapshot.states.map(state => [state.path, state]),
  );
  const observe: WorkspaceSourceReadObserver = (input, operation, existed) => {
    const lexical = path.resolve(input);
    let ancestor = lexical;
    let ancestorState = originalStates.get(ancestor);
    while (ancestorState?.resolvedPath === undefined) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor)
        throw new Error(`Uncovered declarative workspace input: ${input}`);
      ancestor = parent;
      ancestorState = originalStates.get(ancestor);
    }
    const canonicalPath = path.join(
      ancestorState.resolvedPath,
      path.relative(ancestor, lexical),
    );
    observations.push(
      Object.freeze({ path: lexical, canonicalPath, operation, existed }),
    );
  };
  return {
    observe,
    assertUnchanged() {
      assertConsumedConfigInputsUnchanged({
        workspaceRoot,
        stagedWorkspaceRoot: workspaceRoot,
        captures: [
          {
            sourceSnapshot,
            consumedSourceInputs: Object.freeze({
              kind: 'observed-config-source-inputs',
              version: 1,
              observations: Object.freeze([...observations]),
              packageMetadata: Object.freeze([]),
            }),
          },
        ],
      });
    },
  };
}
