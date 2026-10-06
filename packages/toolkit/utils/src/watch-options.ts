// Type-only watcher surface for consumers that must not load the utils barrel.
export type {
  ChokidarOptions as WatchOptions,
  FSWatcher,
} from '../compiled/chokidar/index.mjs';
