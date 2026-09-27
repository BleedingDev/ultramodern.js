import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCloudflareOutputVerify } from '../src/ultramodern-tooling/commands/cloudflare-output-verify';
import { createWorkspace } from './helpers/workspace-kit';

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

test('--require-public-urls fails an app without a public origin before verifying output', async () => {
  const { tempRoot, workspaceDir } = createWorkspace('require-public-urls', {
    tempPrefix: 'um-cloudflare-public-urls-',
  });
  const names = [
    'ULTRAMODERN_PUBLIC_URL_SHELL_SUPER_APP',
    'MODERN_PUBLIC_SITE_URL',
    'ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN',
  ];
  const previous = names.map(name => [name, process.env[name]] as const);
  const context = { workspaceRoot: workspaceDir, invocationCwd: workspaceDir };
  try {
    for (const name of names) delete process.env[name];
    process.env.ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN = '  ';
    await expect(
      runCloudflareOutputVerify(
        ['--app', 'shell-super-app', '--require-public-urls'],
        context,
      ),
    ).rejects.toThrow(
      `Cloudflare deploy for shell-super-app needs ${names.join(', ')}.`,
    );

    process.env.MODERN_PUBLIC_SITE_URL = 'https://shop.example';
    // The origin check passes; output verification decides the rest.
    const outcome = await runCloudflareOutputVerify(
      ['--app', 'shell-super-app', '--require-public-urls'],
      context,
    ).then(String, (error: Error) => error.message);
    expect(outcome).not.toContain('Cloudflare deploy for');
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('--require-public-urls needs --app to know the public URL env', async () => {
  await expect(
    runCloudflareOutputVerify(
      ['--output', 'missing-output', '--require-public-urls'],
      { workspaceRoot: '/nonexistent', invocationCwd: '/nonexistent' },
    ),
  ).rejects.toThrow('--require-public-urls needs --app, not --output');
});
