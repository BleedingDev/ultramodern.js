import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rspack } from '@rslib/core';

// Resolves the published `./rsc` export map with Rspack's own resolver, so the
// worker build picks the edge Flight runtime by condition, not by an alias.
const resolveRsc = (directory: string, conditionNames: string[]) => {
  const resolver = new rspack.experiments.resolver.ResolverFactory({
    conditionNames,
  });
  return resolver.sync(directory, '@modern-js/render/rsc').path;
};

test('export conditions select the edge or Node RSC runtime', () => {
  const appDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'render-rsc-')),
  );
  try {
    const packageDirectory = path.join(
      appDirectory,
      'node_modules/@modern-js/render',
    );
    fs.mkdirSync(path.join(packageDirectory, 'dist/esm'), { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, '../../package.json'),
      path.join(packageDirectory, 'package.json'),
    );
    for (const file of ['rsc.mjs', 'rsc.edge.mjs']) {
      fs.writeFileSync(path.join(packageDirectory, 'dist/esm', file), '');
    }
    const edge = path.join(packageDirectory, 'dist/esm/rsc.edge.mjs');
    const node = path.join(packageDirectory, 'dist/esm/rsc.mjs');

    for (const condition of ['workerd', 'worker', 'edge-light']) {
      expect(resolveRsc(appDirectory, [condition, 'import'])).toBe(edge);
    }
    expect(resolveRsc(appDirectory, ['node', 'import'])).toBe(node);
    expect(
      resolveRsc(appDirectory, ['react-server', 'workerd', 'import']),
    ).toBe(edge);
  } finally {
    fs.rmSync(appDirectory, { force: true, recursive: true });
  }
});
