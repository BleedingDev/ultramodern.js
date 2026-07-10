// Fixture: shell composition host. Exercises G1 (api subpath), G2 (MF literal),
// and a dynamic-consumption warning (loadRemote with a non-literal specifier).
import { alphaApi } from '@fx/alpha/api/client'; // G1 -> shell->alpha#api

const AlphaWidget = createHydratedRemote(AlphaRef, 'alpha/Widget'); // G2 -> shell->alpha#Widget
const BetaWidget = () => import('beta/Widget'); // G2 bare literal -> shell->beta#Widget
const BetaRoute = () => loadRemote('beta/Route'); // G2 loadRemote literal -> shell->beta#Route

// G4-consume-surface: canonical SurfaceRef string form 'unitId#surfaceId[@vN]'.
const AlphaCart = consumeSurface({
  ref: 'fx/alpha#Cart@v2', // G4 -> shell->alpha#Cart
  degraded: () => null,
});

export async function loadDynamic(specifier: string) {
  // dynamic-consumption: non-literal specifier is invisible to static extraction.
  return loadRemote<RemoteModule>(specifier);
}

// dynamic-consumption: consumeSurface with a computed (non-literal) ref is
// invisible to static edge extraction and must surface as a warning, not silence.
export function consumeDynamic(dynamicRef: string) {
  return consumeSurface({ ref: dynamicRef, degraded: () => null });
}

export { AlphaCart, AlphaWidget, alphaApi, BetaRoute, BetaWidget };
