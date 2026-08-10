import { execa, fs as fse } from '@modern-js/utils';
import path from 'path';
import { modernBuild } from '../../../utils/modernTestUtils';

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

describe('deploy', () => {
  beforeAll(async () => {
    await modernBuild(appDir, [], {});
  });

  test('support csr when deploy target is node', async () => {
    await execa('npx modern deploy -s', {
      shell: true,
      cwd: appDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        MODERNJS_DEPLOY: 'node',
      },
    });
    const outputDirectory = path.join(appDir, '.output');
    const bootstrapJs = path.join(outputDirectory, 'index.js');
    const staticDirectory = path.join(outputDirectory, 'static');
    const htmlDirectory = path.join(outputDirectory, 'html');

    expect(await fse.pathExists(bootstrapJs)).toBe(true);
    expect(await fse.pathExists(staticDirectory)).toBe(true);
    expect(await fse.pathExists(htmlDirectory)).toBe(true);
  });

  test('support csr when deploy target is vercel', async () => {
    await execa('npx modern deploy -s', {
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
    const htmlDirectory = path.join(staticDirectory, 'html');
    const publicDirectory = path.join(staticDirectory, 'static');
    const configPath = path.join(outputDirectory, 'config.json');
    const config = await import(configPath);

    expect(await fse.pathExists(staticDirectory)).toBe(true);
    expect(await fse.pathExists(htmlDirectory)).toBe(true);
    expect(await fse.pathExists(publicDirectory)).toBe(true);
    expect(config.version).toBe(3);
    expect(config).toMatchSnapshot();
  });

  test('support csr when deploy target is netlify', async () => {
    await execa('npx modern deploy -s', {
      shell: true,
      cwd: appDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        MODERNJS_DEPLOY: 'netlify',
      },
    });

    const outputDirectory = path.join(appDir, 'dist');
    const staticDirectory = path.join(outputDirectory, 'static');
    const htmlDirectory = path.join(outputDirectory, 'html');
    const redirectPath = path.join(outputDirectory, '_redirects');
    const redirectRules = parseNetlifyRedirectRules(
      (await fse.readFile(redirectPath)).toString(),
    );

    expect(await fse.pathExists(staticDirectory)).toBe(true);
    expect(await fse.pathExists(htmlDirectory)).toBe(true);
    expect(redirectRules).toEqual([
      {
        source: '/one/*',
        destination: '/html/one/index.html',
        status: 200,
      },
      {
        source: '/two/*',
        destination: '/html/two/index.html',
        status: 200,
      },
    ]);
  });
});
