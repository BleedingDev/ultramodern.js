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

test('preserves compact Tractor registry generics across generator formatting', () => {
  assert.equal(
    generatedUiSourceRequiresRewrite(
      `loader: () =>
  import('checkout/AddToCart') as Promise<RemoteComponentModule<AddToCartProps>>,`,
      `loader: () =>
  import('checkout/AddToCart') as Promise<
    RemoteComponentModule<AddToCartProps>
  >,`,
    ),
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

test('does not erase literal whitespace or operator boundaries', () => {
  assert.equal(
    generatedUiSourceRequiresRewrite(
      '<template data-label="Add to cart" />',
      '<template data-label="Add  to cart" />',
    ),
    true,
  );
  assert.equal(
    generatedUiSourceRequiresRewrite(
      'const result = value + +next;',
      'const result = value++ + next;',
    ),
    true,
  );
});
