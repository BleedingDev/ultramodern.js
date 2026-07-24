import assert from 'node:assert/strict';
import { generatedUiSourceRequiresRewrite } from '../src/ultramodern-tooling/commands/migrate-strict-effect/generated-ui-source';

const multilineFragment = `<template
  data-modern-boundary-id="verticalCheckout"
  data-modern-distributed-ssr-marker="start"
  data-modern-mf-expose="./AddToCart"
/>`;

const compactFragment =
  '<template data-modern-boundary-id="verticalCheckout" data-modern-distributed-ssr-marker="start" data-modern-mf-expose="./AddToCart" />';

test('preserves byte formatting for an equivalent generated UI source', () => {
  assert.equal(
    generatedUiSourceRequiresRewrite(multilineFragment, compactFragment),
    false,
  );
});

test('rewrites a generated UI source when its runtime contract changes', () => {
  assert.equal(
    generatedUiSourceRequiresRewrite(
      multilineFragment,
      compactFragment.replace('./AddToCart', './CartPage'),
    ),
    true,
  );
});
