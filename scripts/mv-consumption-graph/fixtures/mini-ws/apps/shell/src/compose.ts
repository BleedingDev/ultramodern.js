// Fixture: shell composition host. Exercises G1 (api subpath), G2 (MF literal),
// and a dynamic-consumption warning (loadRemote with a non-literal specifier).
import { alphaApi } from '@fx/alpha/api/client'; // G1 -> shell->alpha#api

const AlphaWidget = createHydratedRemote(AlphaRef, 'alpha/Widget'); // G2 -> shell->alpha#Widget
const BetaWidget = () => import('beta/Widget'); // G2 bare literal -> shell->beta#Widget

export async function loadDynamic(specifier: string) {
  // dynamic-consumption: non-literal specifier is invisible to static extraction.
  return loadRemote<RemoteModule>(specifier);
}

export { AlphaWidget, alphaApi, BetaWidget };
