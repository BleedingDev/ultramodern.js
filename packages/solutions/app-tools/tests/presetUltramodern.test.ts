import { createAppBaselineConfig, withAppBaseline } from '../src/baseline';
import {
  createPresetUltramodernConfig,
  presetUltramodern,
} from '../src/presetUltramodern';

describe('presetUltramodern', () => {
  it('matches the current app baseline config for app-tools owned defaults', () => {
    expect(createPresetUltramodernConfig()).toEqual(createAppBaselineConfig());
  });

  it('preserves caller overrides when composed', () => {
    expect(
      presetUltramodern({
        output: {
          precompress: false,
        },
      }),
    ).toEqual(
      withAppBaseline({
        output: {
          precompress: false,
        },
      }),
    );
  });
});
