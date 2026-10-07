import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@rstest/core';
import {
  assertRouteSourcesMatchRenderer,
  detectSourceRenderer,
} from '../../src/native-composition/renderer-source-ownership';

const roots: string[] = [];

function app(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-source-'));
  roots.push(root);
  for (const [name, source] of Object.entries(files)) {
    const file = path.join(root, 'src', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

const solidRoutes = {
  'routes/layout.tsx':
    "import { Link, Outlet } from '@modern-js/renderer-solid/router';\nimport type { JSX } from '@solidjs/web';\n",
  'routes/page.data.ts':
    "import type { DataHandlerInput } from '@modern-js/renderer-core/data';\n",
  'routes/about/page.tsx':
    "import { Link } from '@modern-js/renderer-solid/router';\n",
};

describe('route source renderer ownership', () => {
  it.each(['octane', 'react'] as const)(
    'names Solid route modules when renderer %s is selected',
    renderer => {
      const root = app(solidRoutes);
      let message = '';
      try {
        assertRouteSourcesMatchRenderer(renderer, root, path.join(root, 'src'));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(
        `renderer-source-mismatch: modern.config selects renderer ${renderer}, but these route modules are authored for solid:`,
      );
      expect(message).toContain(
        "src/routes/layout.tsx imports '@modern-js/renderer-solid/router' (solid)",
      );
      expect(message).toContain(
        "src/routes/about/page.tsx imports '@modern-js/renderer-solid/router' (solid)",
      );
      expect(message).not.toContain('page.data.ts');
      expect(message).toContain("or set renderer: 'solid' in modern.config.");
    },
  );

  it('accepts route modules authored for the selected renderer', () => {
    const root = app(solidRoutes);
    expect(() =>
      assertRouteSourcesMatchRenderer('solid', root, path.join(root, 'src')),
    ).not.toThrow();
  });

  it('accepts an application without convention routes', () => {
    const root = app({ 'App.tsx': "import 'solid-js';\n" });
    expect(() =>
      assertRouteSourcesMatchRenderer('react', root, path.join(root, 'src')),
    ).not.toThrow();
  });

  it('recognizes React, Octane and pragma evidence and ignores comments', () => {
    expect(
      detectSourceRenderer(
        'page.tsx',
        "import { Outlet } from '@modern-js/plugin-tanstack/runtime';",
      ),
    ).toEqual({
      renderer: 'react',
      evidence: "imports '@modern-js/plugin-tanstack/runtime'",
    });
    expect(
      detectSourceRenderer(
        'page.tsx',
        "import { useMemo } from 'octane';\nimport x from '@octanejs/tanstack-router';",
      ),
    ).toEqual({ renderer: 'octane', evidence: "imports 'octane'" });
    expect(detectSourceRenderer('page.tsrx', '')).toEqual({
      renderer: 'octane',
      evidence: 'is a .tsrx module',
    });
    expect(
      detectSourceRenderer('page.tsx', '/** @jsxImportSource solid-js */'),
    ).toEqual({
      renderer: 'solid',
      evidence: 'declares @jsxImportSource solid-js',
    });
    expect(
      detectSourceRenderer(
        'page.tsx',
        "// ported from 'react'\n/* import x from 'react' */\nconst url = 'https://react.dev';",
      ),
    ).toBeUndefined();
  });
});
