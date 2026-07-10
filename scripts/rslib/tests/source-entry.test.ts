import { describe, expect, it } from '@rstest/core';
import { RSLIB_CODE_ENTRY_GLOB, rslibConfig } from '../src/index';

const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'mts', 'cjs', 'cts'];

describe('Rslib bundleless source entries', () => {
  it('includes code files and excludes Markdown files', () => {
    const extensionGroup = RSLIB_CODE_ENTRY_GLOB.match(/\{([^}]+)\}/u)?.[1];
    const codeEntryPattern = new RegExp(
      `\\.(${extensionGroup?.split(',').join('|')})$`,
      'u',
    );

    expect(extensionGroup?.split(',')).toEqual(codeExtensions);
    expect(extensionGroup?.split(',')).not.toContain('md');
    expect(
      codeEntryPattern.test(
        'src/ultramodern-workspace/delivery-unit-schema/SPEC.md',
      ),
    ).toBe(false);

    for (const extension of codeExtensions) {
      expect(codeEntryPattern.test(`src/entry.${extension}`)).toBe(true);
    }
  });

  it('applies the policy to every bundleless library output', () => {
    expect(rslibConfig.lib?.map(lib => lib.source?.entry)).toEqual(
      Array.from({ length: 3 }, () => ({
        index: [RSLIB_CODE_ENTRY_GLOB],
      })),
    );
  });
});
