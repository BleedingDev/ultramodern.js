type MetricTags = Record<string, unknown>;

type Metrics = {
  emitCounter: (
    name: string,
    value: number,
    prefix?: string,
    labels?: MetricTags,
  ) => void;
  emitTimer: (
    name: string,
    value: number,
    prefix?: string,
    labels?: MetricTags,
  ) => void;
  gauges: (
    labels: MetricTags,
    value: number,
    name: string,
    prefix?: string,
  ) => void;
};

const noop = () => {
  // intentionally empty
};

export const metrics: Metrics = {
  emitCounter: noop,
  emitTimer: noop,
  gauges: noop,
};
