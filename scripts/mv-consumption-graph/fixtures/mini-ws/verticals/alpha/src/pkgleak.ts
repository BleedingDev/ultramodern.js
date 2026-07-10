// Fixture: PACKAGE-FORM ISOLATION BYPASS — alpha reaches into beta's internals
// through a package-form deep import ('@fx/beta/src/internal') rather than a
// relative import. The subpath 'src/internal' is not one of beta's published
// surfaces (Route, Widget, api/client), so this bypasses the Isolation Boundary
// just as a relative source import would.
import { betaInternal } from '@fx/beta/src/internal';
export const pkgLeaked = betaInternal;
