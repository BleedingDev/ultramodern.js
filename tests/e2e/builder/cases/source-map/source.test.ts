import { expect, test } from '@playwright/test';
import { build } from '@scripts/shared';
import { join } from 'path';
import sourceMap from 'source-map';

const fixtures = __dirname;

test('source-map', async () => {
  const builder = await build({
    cwd: fixtures,
    entry: {
      main: join(fixtures, 'src/index.js'),
    },
    builderConfig: {
      output: {
        legalComments: 'none',
      },
      splitChunks: false,
    },
  });

  const files = await builder.unwrapOutputJSON(false);
  const [, jsMapContent] = Object.entries(files).find(
    ([name]) => name.includes('static/js/') && name.endsWith('.js.map'),
  )!;

  const consumer = await new sourceMap.SourceMapConsumer(jsMapContent);
  const appSource = consumer.sources.find(source =>
    source.endsWith('src/App.jsx'),
  );
  const indexSource = consumer.sources.find(source =>
    source.endsWith('src/index.js'),
  );
  if (!appSource || !indexSource) {
    throw new Error('source map omitted an application source');
  }

  const originalPositions = [
    { source: appSource, line: 1, column: 0 },
    { source: indexSource, line: 5, column: 0 },
  ].map(originalPosition => {
    const generated = consumer.generatedPositionFor(originalPosition);
    if (generated.line === null || generated.column === null) {
      throw new Error('source map did not resolve an original position');
    }
    return consumer.originalPositionFor({
      line: generated.line,
      column: generated.column,
    });
  });
  consumer.destroy();

  expect(originalPositions[0]).toMatchObject({
    line: 1,
    column: 0,
    name: null,
  });
  expect(String(originalPositions[0].source)).toMatch(
    /(?:\.\.\/){3}src\/App\.jsx$|\/cases\/source-map\/src\/App\.jsx$/,
  );
  expect(originalPositions[1]).toMatchObject({
    line: 5,
    column: 0,
    name: 'window',
  });
  expect(String(originalPositions[1].source)).toMatch(
    /(?:\.\.\/){3}src\/index\.js$|\/cases\/source-map\/src\/index\.js$/,
  );
});
