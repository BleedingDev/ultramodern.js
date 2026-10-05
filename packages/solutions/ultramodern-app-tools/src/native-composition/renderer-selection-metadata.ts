import { registeredRenderers as rendererIds } from './renderer-registration';

/** Public selection data derives from the actual owners without their CLI types. */
export const registeredRenderers = Object.freeze([...rendererIds]);
export type RegisteredRenderer = (typeof registeredRenderers)[number];
