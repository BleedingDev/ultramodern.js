import type { HydrationInteractionEvents, HydrationPrefetchStrategy } from './types.js';
declare const interactionType = "interaction";
export type InteractionHydrationOptions = {
    events?: HydrationInteractionEvents;
};
export declare function interaction(options?: InteractionHydrationOptions): HydrationPrefetchStrategy<typeof interactionType>;
export {};
