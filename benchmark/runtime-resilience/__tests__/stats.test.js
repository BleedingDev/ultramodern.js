const test = require('node:test');
const assert = require('node:assert/strict');
const { percentile, summarizeLatencies } = require('../stats');

test('percentile returns expected rank values', () => {
  const values = [10, 20, 30, 40, 50];
  assert.equal(percentile(values, 0.5), 30);
  assert.equal(percentile(values, 0.95), 50);
  assert.equal(percentile(values, 0.99), 50);
});

test('summarizeLatencies computes min/max/avg/percentiles', () => {
  const summary = summarizeLatencies([5, 10, 15, 20, 25]);
  assert.equal(summary.count, 5);
  assert.equal(summary.min, 5);
  assert.equal(summary.max, 25);
  assert.equal(summary.avg, 15);
  assert.equal(summary.p50, 15);
  assert.equal(summary.p95, 25);
  assert.equal(summary.p99, 25);
});
