// Fixture: ISOLATION VIOLATION — alpha reaches into beta's source tree via a
// relative import instead of beta's published surface.
import { betaInternal } from '../../beta/src/internal';
// resolves to verticals/beta/src/internal.ts (cross-unit source import)
export const leaked = betaInternal;
