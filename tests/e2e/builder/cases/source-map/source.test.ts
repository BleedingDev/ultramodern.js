import { expect, test } from '@playwright/test';
import { build } from '@scripts/shared';
import { join } from 'path';
import sourceMap from 'source-map';

const fixtures = __dirname;

async function validateSourceMap(
  rawSourceMap: string,
  generatedPositions: {
    line: number;
    column: number;
  }[],
) {
  const consumer = await new sourceMap.SourceMapConsumer(rawSourceMap);

  const originalPositions = generatedPositions.map(generatedPosition =>
    consumer.originalPositionFor({
      line: generatedPosition.line,
      column: generatedPosition.column,
    }),
  );

  consumer.destroy();
  return originalPositions;
}

function normalizeSource(source: string | null) {
  expect(source).toEqual(expect.any(String));
  return source?.split('webpack-builder-source-map/')[1] || source;
}

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

  const [, jsContent] = Object.entries(files).find(
    ([name]) => name.includes('static/js/') && name.endsWith('.js'),
  )!;

  const AppContentIndex = jsContent.indexOf('Hello Builder!');
  const AppComponentMarker = 'createElement(function(){';
  const AppComponentMarkerIndex = jsContent.indexOf(AppComponentMarker);
  const AppComponentIndex = AppComponentMarkerIndex + 'createElement('.length;
  const indexContentIndex = jsContent.indexOf('window.aa');

  expect(AppContentIndex).toBeGreaterThanOrEqual(0);
  expect(AppComponentMarkerIndex).toBeGreaterThanOrEqual(0);
  expect(indexContentIndex).toBeGreaterThanOrEqual(0);

  const originalPositions = (
    await validateSourceMap(jsMapContent, [
      {
        line: 1,
        column: AppComponentIndex,
      },
      {
        line: 1,
        column: indexContentIndex,
      },
    ])
  ).map(o => ({
    ...o,
    source: normalizeSource(o.source),
  }));

  expect(originalPositions[0]).toMatchObject({
    line: 1,
    column: 0,
    name: null,
  });
  expect(String(originalPositions[0].source)).toMatch(
    /(?:\.\.\/){3}src\/App\.jsx$|\/cases\/source-map\/src\/App\.jsx$/,
  );
  const sourceMapJson = JSON.parse(jsMapContent);
  const appSourceIndex = sourceMapJson.sources.findIndex((source: string) =>
    source.endsWith('src/App.jsx'),
  );
  expect(appSourceIndex).toBeGreaterThanOrEqual(0);
  expect(sourceMapJson.sourcesContent[appSourceIndex]).toContain(
    'Hello Builder!',
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
