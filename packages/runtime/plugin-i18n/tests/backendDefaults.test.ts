import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from '@rstest/core';
import {
  DEFAULT_I18NEXT_BACKEND_OPTIONS,
  resolveDefaultLocalesDir,
} from '../src/runtime/i18n/backend/defaults.node';

const makeTempDir = (...dirs: string[]): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-defaults-'));
  for (const dir of dirs) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  return root;
};

describe('node backend default loadPath', () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
  });

  test('prefers the project-root ./locales convention (the detection root)', () => {
    const root = makeTempDir('locales', 'config/public/locales');
    expect(resolveDefaultLocalesDir(root)).toBe('./locales');
  });

  test('falls back to ./config/public/locales when only it exists', () => {
    const root = makeTempDir('config/public/locales');
    expect(resolveDefaultLocalesDir(root)).toBe('./config/public/locales');
  });

  test('defaults to ./locales when neither conventional directory exists', () => {
    const root = makeTempDir();
    expect(resolveDefaultLocalesDir(root)).toBe('./locales');
  });

  test('DEFAULT_I18NEXT_BACKEND_OPTIONS resolves against the working directory', () => {
    const root = makeTempDir('locales');
    process.chdir(root);

    expect(DEFAULT_I18NEXT_BACKEND_OPTIONS.loadPath).toBe(
      './locales/{{lng}}/{{ns}}.json',
    );
    expect(DEFAULT_I18NEXT_BACKEND_OPTIONS.addPath).toBe(
      './locales/{{lng}}/{{ns}}.json',
    );
  });
});
