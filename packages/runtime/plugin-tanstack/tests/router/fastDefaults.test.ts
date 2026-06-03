import {
  getModernTanstackRouterFastDefaults,
  modernTanstackRouterFastDefaults,
} from '../../src/runtime/types';

describe('tanstack router fast defaults', () => {
  test('enables structural sharing by default', () => {
    expect(modernTanstackRouterFastDefaults).toEqual({
      defaultStructuralSharing: true,
    });
    expect(getModernTanstackRouterFastDefaults()).toEqual({
      defaultStructuralSharing: true,
    });
  });

  test('allows explicit structural sharing override', () => {
    expect(
      getModernTanstackRouterFastDefaults({
        defaultStructuralSharing: false,
      }),
    ).toEqual({
      defaultStructuralSharing: false,
    });
  });
});
