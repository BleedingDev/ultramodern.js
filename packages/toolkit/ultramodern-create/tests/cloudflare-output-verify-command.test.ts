import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCloudflareOutputVerify } from '../src/ultramodern-tooling/commands/cloudflare-output-verify';

const require = createRequire(import.meta.url);

test('Cloudflare command resolves the native provider and reports output diagnostics', () => {
  const workspaceRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-cloudflare-command-'),
  );
  try {
    fs.writeFileSync(
      path.join(workspaceRoot, 'package.json'),
      '{"private":true}\n',
    );
    const scope = path.join(workspaceRoot, 'node_modules/@modern-js');
    fs.mkdirSync(scope, { recursive: true });
    fs.symlinkSync(
      path.resolve(__dirname, '../../../solutions/app-tools-extensions'),
      path.join(scope, 'app-tools-extensions'),
      'dir',
    );
    const commandUrl = pathToFileURL(
      path.resolve(
        __dirname,
        '../src/ultramodern-tooling/commands/cloudflare-output-verify.ts',
      ),
    ).href;
    const runner = path.join(workspaceRoot, 'run-command.mts');
    fs.writeFileSync(
      runner,
      `import { runCloudflareOutputVerify } from ${JSON.stringify(commandUrl)};\nprocess.exit(await runCloudflareOutputVerify(process.argv.slice(2), { workspaceRoot: process.cwd(), invocationCwd: process.cwd() }));\n`,
    );
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(require.resolve('tsx')).href,
        runner,
        '--output',
        'missing-output',
      ],
      { cwd: workspaceRoot, encoding: 'utf8' },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      '[ultramodern] Cloudflare output failed: missing-output',
    );
    expect(result.stderr).toContain(
      '- missing-file: Cloudflare output is missing',
    );
    expect(result.stderr).not.toContain('MODULE_NOT_FOUND');
    expect(result.stderr).not.toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Cloudflare command rejects conflicting selectors before loading a provider', async () => {
  await expect(
    runCloudflareOutputVerify(
      ['--app', 'shell-super-app', '--output', 'missing-output'],
      { workspaceRoot: '/nonexistent', invocationCwd: '/nonexistent' },
    ),
  ).rejects.toThrow('Use either --app or --output, not both.');
});
