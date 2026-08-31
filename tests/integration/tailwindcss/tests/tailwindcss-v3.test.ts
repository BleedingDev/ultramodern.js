import fs from 'fs';
import path from 'path';
import { fixtures, launchAppWithPage } from './utils';

rstest.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe('use tailwindcss v3', () => {
  const appDir = path.resolve(fixtures, 'tailwindcss-v3');

  test('uses the Tailwind CSS v3 PostCSS contract', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(appDir, 'package.json'), 'utf8'),
    );
    const tailwindConfig = fs.readFileSync(
      path.resolve(appDir, 'tailwind.config.js'),
      'utf8',
    );
    const appCss = fs.readFileSync(path.resolve(appDir, 'src/app.css'), 'utf8');

    expect(manifest.dependencies).toMatchObject({
      autoprefixer: '10.5.2',
      postcss: '^8.5.26',
      tailwindcss: '^3.4.19',
    });
    expect(tailwindConfig).toContain("content: ['./src/**/*.{js,jsx,ts,tsx}']");
    expect(tailwindConfig).not.toContain('purge:');
    expect(appCss).toContain('@tailwind base;');
    expect(appCss).toContain('@tailwind components;');
    expect(appCss).toContain('@tailwind utilities;');
  });

  test(`should show style by use tailwindcss theme`, async () => {
    const { page, clear } = await launchAppWithPage(appDir);
    try {
      const primaryColorElement = await page.waitForSelector('.bg-primary');
      const backgroundColor = await page.evaluate(element => {
        const style = window.getComputedStyle(element);
        return style.backgroundColor;
      }, primaryColorElement);

      expect(backgroundColor).toMatch(/rgb\(0, 0, 255\)|#0000ff|blue/i);

      const macroElement = await page.waitForSelector(
        '[data-testid="tailwind-v3-macro"]',
      );
      const macroStyle = await page.evaluate(element => {
        const style = window.getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          height: style.height,
          width: style.width,
        };
      }, macroElement);

      expect(macroStyle).toEqual({
        backgroundColor: 'rgb(253, 224, 71)',
        height: '50px',
        width: '200px',
      });
    } finally {
      await clear();
    }
  });
});
