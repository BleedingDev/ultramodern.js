import * as RootSurface from '../src';
import * as EffectSurface from '../src/effect';
import * as EffectEdgeSurface from '../src/effect/edge';

describe('Effect validator trust surface', () => {
  test.each([
    ['root', RootSurface],
    ['effect', EffectSurface],
    ['effect-edge', EffectEdgeSurface],
  ])('keeps validator trust internals out of %s', (_name, surface) => {
    expect(surface).not.toHaveProperty('EFFECT_VALIDATOR_AWARE_FACTORY');
    expect(surface).not.toHaveProperty('isValidatorAwareHandlerFactory');
    expect(surface).not.toHaveProperty('registerValidatorAwareHandlerFactory');
  });

  test('keeps evaluator-backed documentation UIs out of the edge surface', () => {
    expect(EffectEdgeSurface).not.toHaveProperty('HttpApiScalar');
    expect(EffectEdgeSurface).not.toHaveProperty('HttpApiSwagger');
  });
});
