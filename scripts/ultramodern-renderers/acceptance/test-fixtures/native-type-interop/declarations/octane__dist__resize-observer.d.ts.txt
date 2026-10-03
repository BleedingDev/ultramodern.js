/**
 * A native ResizeObserver whose callbacks run in a task outside the browser's
 * resize delivery loop. State updates and DOM writes can then resize observed
 * targets without triggering an undelivered-notifications error in that loop.
 *
 * Entries are coalesced by target, retaining the latest native entry. Unobserving
 * a target discards its queued entry; disconnecting discards the entire batch.
 * The observer remains reusable after disconnect. Supply an owning window's
 * constructor when observing elements in another realm.
 *
 * Scheduling is independent of component commits and passive-effect drains.
 * Nothing is initialized at module evaluation, so SSR can import this helper.
 */
export declare function createResizeObserver(callback: ResizeObserverCallback, ResizeObserverCtor?: typeof ResizeObserver): ResizeObserver;
