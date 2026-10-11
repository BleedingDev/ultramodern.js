import fs from 'node:fs';
import * as actualModule from 'node:module' with { rstest: 'importActual' };
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import {
  assertRouteSourcesMatchRenderer,
  detectSourceRenderer,
} from '../../src/native-composition/renderer-source-ownership';

// No native renderer package is installed: ownership must not need them.
const adapterRequests: string[] = [];
rstest.mock('node:module', () => {
  const createRequire: typeof actualModule.createRequire = anchor => {
    const require = actualModule.createRequire(anchor);
    return Object.assign((id: string) => {
      if (/^@modern-js\/renderer-[^/]+\/plugin$/u.test(id)) {
        adapterRequests.push(id);
        throw Object.assign(new Error(`Cannot find module '${id}'`), {
          code: 'MODULE_NOT_FOUND',
        });
      }
      return require(id);
    }, require) as NodeJS.Require;
  };
  return {
    ...actualModule,
    createRequire,
    default: { ...actualModule, createRequire },
  };
});

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

  it('names routes of an uninstalled renderer without loading any adapter', () => {
    const root = app({
      'routes/page.tsrx': 'export default component Page() {}\n',
      'routes/solid/page.tsx': "import { createSignal } from 'solid-js';\n",
      'routes/react/page.tsx': "import { Link } from 'react-router';\n",
    });
    let message = '';
    try {
      assertRouteSourcesMatchRenderer('react', root, path.join(root, 'src'));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(
      'src/routes/page.tsrx is a .tsrx module (octane)',
    );
    expect(message).toContain(
      "src/routes/solid/page.tsx imports 'solid-js' (solid)",
    );
    expect(message).not.toContain('react/page.tsx');
    expect(adapterRequests).toEqual([]);
  });

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
      detectSourceRenderer('page.tsx', "import { Link } from 'react-router';"),
    ).toEqual({ renderer: 'react', evidence: "imports 'react-router'" });
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
