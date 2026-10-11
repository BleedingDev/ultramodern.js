import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { resolveEffectTsgoCompiler } from '@modern-js/app-tools-extensions/config';
import { createTsConfigBase } from '../src/ultramodern-workspace/tsconfigs';
import { linkInstalledEffectCompiler } from './helpers/workspace-kit';

const require = createRequire(import.meta.url);
const effectRequire = createRequire(
  path.resolve(__dirname, '../../../server/bff-effect/package.json'),
);

test.each([
  {
    name: 'supports HTTP/RPC with visible stability notices',
    source: `import { HttpServerResponse } from "effect/http";
import { Rpc } from "effect/rpc";
export const response = HttpServerResponse.text("ready");
export const ping = Rpc.make("Ping");
`,
    status: 0,
    code: 'TS377136',
  },
  {
    name: 'rejects ordinary type errors',
    source: 'export const value: string = 123;\n',
    status: 1,
    code: 'TS2322',
  },
  {
    name: 'rejects floating Effects',
    source: `import * as Effect from "effect/Effect";
Effect.log("forgotten");
`,
    status: 1,
    code: 'TS377001',
  },
  {
    name: 'rejects experimental API usage',
    // Effect 4 has no experimental export. This authored annotation exercises
    // the native rule's public contract, as its own compiler fixtures do.
    source: `import * as Effect from "effect/Effect";
/** @stability experimental */
export const previewApi = () => 1;
export const preview = previewApi();
export const effect = Effect.succeed(1);
`,
    status: 1,
    code: 'TS377135',
  },
])('generated native Effect policy $name', ({ source, status, code }) => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'um-effect-diagnostics-')),
  );
  try {
    linkInstalledEffectCompiler(root);
    for (const [name, provider] of [
      ['effect', effectRequire],
      ['@types/node', require],
    ] as const) {
      const destination = path.join(root, 'node_modules', name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.symlinkSync(
        path.dirname(provider.resolve(`${name}/package.json`)),
        destination,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    expect(
      JSON.parse(
        fs.readFileSync(effectRequire.resolve('effect/package.json'), 'utf8'),
      ).version,
    ).toBe('4.0.0');
    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      JSON.stringify(createTsConfigBase()),
    );
    const input = path.join(root, 'fixture.ts');
    fs.writeFileSync(input, source);

    const checked = spawnSync(
      resolveEffectTsgoCompiler({ from: input }),
      ['--project', 'tsconfig.json', '--pretty', 'false', '--checkers', '1'],
      { cwd: root, encoding: 'utf8', timeout: 20_000 },
    );
    const output = checked.stdout + checked.stderr;
    expect(checked.error).toBeUndefined();
    expect(checked.status).toBe(status);
    expect([...new Set(output.match(/\bTS\d+\b/g))]).toEqual([code]);
    if (status === 0) {
      expect(output).toContain('message TS377136');
    } else {
      expect(output).toContain(`error ${code}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
