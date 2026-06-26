import {
  getModernTanstackRouterFastDefaults,
  modernTanstackRouterFastDefaults,
} from '../../src/runtime/types';

describe('tanstack router fast defaults', () => {
  test('keeps structural sharing opt-in by default', () => {
    expect(modernTanstackRouterFastDefaults).toEqual({
      defaultStructuralSharing: false,
    });
    expect(getModernTanstackRouterFastDefaults()).toEqual({
      defaultStructuralSharing: false,
    });
  });

  test('allows explicit structural sharing override', () => {
    expect(
      getModernTanstackRouterFastDefaults({
        defaultStructuralSharing: true,
      }),
    ).toEqual({
      defaultStructuralSharing: true,
    });
    expect(
      getModernTanstackRouterFastDefaults({
        defaultStructuralSharing: false,
      }),
    ).toEqual({
      defaultStructuralSharing: false,
    });
  });
});
