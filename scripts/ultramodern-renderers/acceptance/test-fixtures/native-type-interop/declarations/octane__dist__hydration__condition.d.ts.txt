import type { HydrationStrategy } from './types.js';
declare const conditionType = "condition";
export type HydrationCondition = boolean | (() => boolean);
export declare function condition(conditionValue: HydrationCondition): HydrationStrategy<typeof conditionType, false>;
export {};
