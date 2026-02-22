import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';

const require = createRequire(import.meta.url);
const { launchOptions } = require('./launchOptions');

const DIR = path.join(os.tmpdir(), 'vitest_puppeteer_global_setup');
const WS_ENDPOINT_PATH = path.join(DIR, 'wsEndpoint');

export default async function globalSetup() {
  const browser = await puppeteer.launch({
    ...launchOptions,
    dumpio: false,
  });

  mkdirSync(DIR, { recursive: true });
  writeFileSync(WS_ENDPOINT_PATH, browser.wsEndpoint(), 'utf8');

  return async () => {
    await browser.close();
    rmSync(DIR, { recursive: true, force: true });
  };
}
