import * as generationSurface from '../src/cross-project-generation';
import { renderProducerRuntimeDefaults } from '../src/cross-project-generation';

describe('cross-project generation', () => {
  test('keeps the semantic generation surface minimal', () => {
    expect(Object.keys(generationSurface)).toEqual([
      'renderProducerRuntimeDefaults',
    ]);
  });

  test('owns the secure cross-project producer defaults', () => {
    expect(renderProducerRuntimeDefaults('"catalog.producer"')).toContain(
      'requestId: "catalog.producer"',
    );
    expect(renderProducerRuntimeDefaults('"catalog.producer"')).toContain(
      'requireSchemaHash: true',
    );
  });
});
