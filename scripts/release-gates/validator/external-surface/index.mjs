// External-surface validator barrel (G13b/G14/G15/G18). Pure node ESM.
// Wired NOWHERE yet — the gate runner integrator imports from here.

export { checkBaselineCompatibility, majorOf } from './baseline-compat.mjs';
export { compareMfSurface } from './compare-mf.mjs';
export { compareRestSurface } from './compare-rest.mjs';
export { compareRpcSurface } from './compare-rpc.mjs';
export { stableHash, stableStringify } from './hash.mjs';
export { evaluateZonePolicy } from './zone-policy.mjs';
