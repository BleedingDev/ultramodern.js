import { execa, fs as fse } from '@modern-js/utils';
import path from 'path';
import {
  getPort,
  killApp,
  modernBuild,
  runContinuousTask,
} from '../../../utils/modernTestUtils';

rstest.setConfig({ testTimeout: 1000 * 60 * 2, hookTimeout: 1000 * 60 * 2 });

const appDir = path.resolve(__dirname, '../');

function parseNetlifyRedirectRules(content: string) {
  return content
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
    .map(line => {
      const fields = line.split(/\s+/u);
      const source = fields.at(0);
      const destination = fields.at(1);
      const statusText = fields.at(2);

      if (
        fields.length !== 3 ||
        source === undefined ||
        destination === undefined ||
        statusText === undefined
      ) {
        throw new Error(`Invalid Netlify redirect rule: ${line}`);
      }

      const status = Number(statusText);
      if (!Number.isInteger(status)) {
        throw new Error(`Invalid Netlify redirect status: ${statusText}`);
      }

      return { source, destination, status };
    });
}

async function checkAppRun(host: string) {
  // Page render
  const onePage = await fetch(`${host}/one`);
  expect(onePage.status).toBe(200);
  expect(await onePage.text()).toContain('<div id="item">');

  // Loader
  const oneLoader = await fetch(`${host}/one?__loader=one_page`);
  expect(oneLoader.status).toBe(200);
  expect(await oneLoader.text()).toContain('Hello Modern.js');

  // API
  const api = await fetch(`${host}/api/context`);
  expect(api.status).toBe(200);
  expect(api.headers.get('x-id')).toBe('1');
  expect(await api.json()).toEqual({
    message: 'Hello Modern.js',
  });
}

// bff project's dependencies is more complex, so use bff project to test
describe('deploy', () => {
  const apps = new Set();

  beforeAll(async () => {
    await modernBuild(appDir, [], {});
  });

  afterAll(async () => {
    await Promise.all([...apps].map(x => killApp(x, true)));
    await fse.remove(path.join(appDir, '.vercel'));
    await fse.remove(path.join(appDir, '.netlify'));
    await fse.remove(path.join(appDir, 'dist-netlify'));
    await fse.remove(path.join(appDir, '.output'));
  });

  test('support server when deploy target is node', async () => {
    await execa('npx modern deploy --skip-build', {
      shell: true,
      cwd: appDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        MODERNJS_DEPLOY: 'node',
      },
    });
    const outputDirectory = path.join(appDir, '.output');
    const staticDirectory = path.join(outputDirectory, 'static');
    const htmlDirectory = path.join(outputDirectory, 'html');
    const apiFile = path.join(outputDirectory, 'api/lambda/index.js');
    const bootstrapPath = path.join(outputDirectory, 'index.js');

    expect(await fse.pathExists(staticDirectory)).toBe(true);
    expect(await fse.pathExists(htmlDirectory)).toBe(true);
    expect(await fse.pathExists(apiFile)).toBe(true);
    expect(await fse.pathExists(bootstrapPath)).toBe(true);

    // check server run
    const port = await getPort();
    const app = await runContinuousTask(['.output/index.js'], undefined, {
      cwd: appDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: port,
      },
      waitMessage: /Server is listening on/i,
    });
    apps.add(app);
    await checkAppRun(`http://localhost:${port}`);
    await killApp(app, true);
    apps.delete(app);
  });

  test('support server when deploy target is vercel', async () => {
    await execa('npx modern deploy --skip-build', {
      shell: true,
      cwd: appDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        MODERNJS_DEPLOY: 'vercel',
      },
    });

    const outputDirectory = path.join(appDir, '.vercel/output');
    const staticDirectory = path.join(outputDirectory, 'static');
    const funcsDirectory = path.join(
      outputDirectory,
      'functions',
      'index.func',
    );
    const funcsConfigPath = path.join(funcsDirectory, '.vc-config.json');
    const funcsConfig = await import(funcsConfigPath);
    const bootstrapFile = path.join(funcsDirectory, 'index.js');
    const htmlDirectory = path.join(funcsDirectory, 'html');
    const publicDirectory = path.join(staticDirectory, 'static');
    const configPath = path.join(outputDirectory, 'config.json');
    const config = await import(configPath);

    expect(await fse.pathExists(staticDirectory)).toBe(true);
    expect(await fse.pathExists(htmlDirectory)).toBe(true);
    expect(await fse.pathExists(publicDirectory)).toBe(true);
    expect(await fse.pathExists(bootstrapFile)).toBe(true);
    expect(config).toMatchSnapshot();
    expect({
      ...funcsConfig.default,
      runtime: expect.any(String),
    }).toMatchSnapshot();
  });

  // deploy to netlify will clean dist, it will cause the verification of node artifacts to fail.
  // so, we changed its dist directory to a separate directory, and build again
  test('support server when deploy target is netlify', async () => {
    await execa('npx modern deploy', {
      shell: true,
      cwd: appDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        TEST_DIST: 'dist-netlify',
        MODERNJS_DEPLOY: 'netlify',
      },
    });

    const publishDir = path.join(appDir, 'dist-netlify');
    const outputDirectory = path.join(appDir, '.netlify');
    const staticDirectory = path.join(publishDir, 'static');
    const funcsDirectory = path.join(outputDirectory, 'functions');
    const redirectFilePath = path.join(publishDir, '_redirects');
    const redirectRules = parseNetlifyRedirectRules(
      (await fse.readFile(redirectFilePath)).toString(),
    );

    const bootstrapFile = path.join(funcsDirectory, 'index.js');
    const htmlDirectory = path.join(funcsDirectory, 'html');

    expect(await fse.pathExists(staticDirectory)).toBe(true);
    expect(await fse.pathExists(htmlDirectory)).toBe(true);
    expect(await fse.pathExists(bootstrapFile)).toBe(true);
    expect(redirectRules).toEqual([
      {
        source: '/*',
        destination: '/.netlify/functions/index',
        status: 200,
      },
    ]);
  });
});
