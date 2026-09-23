import { createStrictEffectApiBoundariesRule } from '../src/oxlint-plugin/rules/strict-effect-api-boundaries';

const messages = (filename: string, source: string): string[] => {
  const output: string[] = [];
  createStrictEffectApiBoundariesRule()
    .create({
      filename,
      getSourceCode: () => ({ text: source }),
      report: descriptor => output.push(descriptor.message),
    })
    .Program({ type: 'Program' });
  return output;
};

test('matches legacy Effect imports by path segment', () => {
  expect(
    messages('src/component.ts', "import { x } from './api/effectual';"),
  ).toEqual([]);
  expect(
    messages('src/component.ts', "import { x } from './shared/effects';"),
  ).toEqual([]);
  expect(
    messages('src/component.ts', "import { x } from './api/effect.ts';").join(
      '\n',
    ),
  ).toContain('Import API code');
  expect(
    messages(
      'src/component.ts',
      "import { x } from './shared/effect/private';",
    ).join('\n'),
  ).toContain('Import API code');
  expect(
    messages(
      'verticals/catalog/api/effect/index.ts',
      'export const x = 1;',
    ).join('\n'),
  ).toContain('api/effect, api/lambda');
});
