const round = value => Math.round(value * 1000) / 1000;

const percentile = (values, p) => {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[rank];
};

const summarizeLatencies = samples => {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      avg: 0,
      p50: 0,
      p95: 0,
      p99: 0,
    };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((acc, item) => acc + item, 0);
  return {
    count: sorted.length,
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    avg: round(total / sorted.length),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
  };
};

module.exports = {
  percentile,
  summarizeLatencies,
};
