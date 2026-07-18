import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalSerializeMicroVerticalReleaseEnvelope,
  createMicroVerticalReleaseEnvelope,
  type MicroVerticalReleaseArtifactInput,
  verifyMicroVerticalReleaseEnvelope,
} from '../src/ultramodern-release-envelope';

const tempDirectories: string[] = [];

const artifact = (
  logicalPath: string,
  runtime: string,
): MicroVerticalReleaseArtifactInput => ({
  logicalPath,
  runtime,
});

const createArtifactRoot = async () => {
  const artifactRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'modern-release-envelope-'),
  );
  tempDirectories.push(artifactRoot);
  const files = {
    'api/handler.mjs': 'export const fetch = () => "api";\n',
    'backend/backend-mf-manifest.json': '{"name":"verticalCatalogBackend"}\n',
    'backend/backendRemoteEntry.mjs': 'export const get = () => "api";\n',
    'ssr/server.mjs': 'export const render = () => "<main>catalog</main>";\n',
    'ui/main.js': 'globalThis.catalog = "client";\n',
    'ui/styles.css': '.catalog { color: green; }\n',
  };
  await Promise.all(
    Object.entries(files).map(async ([logicalPath, contents]) => {
      const filePath = path.join(artifactRoot, logicalPath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, contents);
    }),
  );
  return { artifactRoot, files };
};

const createInput = (artifactRoot: string) => ({
  artifactRoot,
  target: 'node' as const,
  identity: {
    buildMarker: 'catalog-build-a',
    releaseVersion: '1.0.0',
    sourceRevision: 'a'.repeat(40),
    unitId: 'tractor-store/catalog',
  },
  artifacts: [
    artifact('ui/styles.css', 'browser'),
    artifact('ui/main.js', 'browser'),
    artifact('ssr/server.mjs', 'nodejs'),
    artifact('api/handler.mjs', 'nodejs'),
    artifact('backend/backend-mf-manifest.json', 'module-federation-manifest'),
    artifact('backend/backendRemoteEntry.mjs', 'nodejs'),
  ],
  surfaces: {
    uiClient: ['ui/main.js', 'ui/styles.css'],
    ssr: ['ssr/server.mjs'],
    apiBackend: ['api/handler.mjs'],
    backendFederation: {
      manifest: 'backend/backend-mf-manifest.json',
      container: 'backend/backendRemoteEntry.mjs',
    },
  },
});

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('immutable target-specific MicroVertical release envelope', () => {
  it('binds final artifact bytes and identity into one deterministic target envelope', async () => {
    const { artifactRoot, files } = await createArtifactRoot();
    const envelope = await createMicroVerticalReleaseEnvelope(
      createInput(artifactRoot),
    );
    const reorderedInput = createInput(artifactRoot);
    reorderedInput.artifacts.reverse();
    const reordered = await createMicroVerticalReleaseEnvelope(reorderedInput);

    expect(envelope).toEqual(reordered);
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(envelope.target).toBe('node');
    expect(envelope.artifacts.map(item => item.logicalPath)).toEqual([
      'api/handler.mjs',
      'backend/backend-mf-manifest.json',
      'backend/backendRemoteEntry.mjs',
      'ssr/server.mjs',
      'ui/main.js',
      'ui/styles.css',
    ]);
    const backendContainer = envelope.artifacts.find(
      item => item.logicalPath === 'backend/backendRemoteEntry.mjs',
    );
    expect(backendContainer?.sha256).toBe(
      createHash('sha256')
        .update(files['backend/backendRemoteEntry.mjs'])
        .digest('hex'),
    );
    expect(backendContainer?.byteLength).toBe(
      Buffer.byteLength(files['backend/backendRemoteEntry.mjs']),
    );
    expect(canonicalSerializeMicroVerticalReleaseEnvelope(envelope)).toBe(
      canonicalSerializeMicroVerticalReleaseEnvelope(reordered),
    );
  });

  it('allows one real artifact to carry more than one surface role', async () => {
    const { artifactRoot } = await createArtifactRoot();
    const input = createInput(artifactRoot);
    input.surfaces.apiBackend = ['ssr/server.mjs'];
    const envelope = await createMicroVerticalReleaseEnvelope(input);

    expect(envelope.surfaces.ssr).toEqual(['ssr/server.mjs']);
    expect(envelope.surfaces.apiBackend).toEqual(['ssr/server.mjs']);
    expect(
      envelope.artifacts.filter(item => item.logicalPath === 'ssr/server.mjs'),
    ).toHaveLength(1);

    const wrongRuntime = createInput(artifactRoot);
    wrongRuntime.artifacts.find(
      item => item.logicalPath === 'api/handler.mjs',
    )!.runtime = 'workerd-effect';
    await expect(
      createMicroVerticalReleaseEnvelope(wrongRuntime),
    ).rejects.toThrow(
      'node API/backend artifact "api/handler.mjs" must use runtime "nodejs"',
    );
  });

  it('rejects non-release identities and incomplete or ambiguous artifact sets', async () => {
    const { artifactRoot } = await createArtifactRoot();
    const workspaceIdentity = createInput(artifactRoot);
    workspaceIdentity.identity.sourceRevision = 'workspace';
    await expect(
      createMicroVerticalReleaseEnvelope(workspaceIdentity),
    ).rejects.toThrow(
      'sourceRevision must be an exact lowercase 40- or 64-character Git object ID',
    );

    const ambiguousRevision = createInput(artifactRoot);
    ambiguousRevision.identity.sourceRevision = 'revision-one';
    await expect(
      createMicroVerticalReleaseEnvelope(ambiguousRevision),
    ).rejects.toThrow(
      'sourceRevision must be an exact lowercase 40- or 64-character Git object ID',
    );

    const missingSsr = createInput(artifactRoot);
    missingSsr.surfaces.ssr = [];
    await expect(
      createMicroVerticalReleaseEnvelope(missingSsr),
    ).rejects.toThrow('surfaces.ssr must contain at least one artifact path');

    const duplicate = createInput(artifactRoot);
    duplicate.artifacts[0].logicalPath = 'ui/main.js';
    await expect(createMicroVerticalReleaseEnvelope(duplicate)).rejects.toThrow(
      'Duplicate artifact logicalPath "ui/main.js"',
    );

    const unboundSurface = createInput(artifactRoot);
    unboundSurface.surfaces.apiBackend = ['api/not-bound.mjs'];
    await expect(
      createMicroVerticalReleaseEnvelope(unboundSurface),
    ).rejects.toThrow('references unbound artifact "api/not-bound.mjs"');
  });

  it('rejects target mismatch, unknown fields, symlink escapes, and byte drift', async () => {
    const { artifactRoot } = await createArtifactRoot();
    const envelope = await createMicroVerticalReleaseEnvelope(
      createInput(artifactRoot),
    );

    await expect(
      verifyMicroVerticalReleaseEnvelope(envelope, {
        artifactRoot,
        expectedTarget: 'cloudflare',
      }),
    ).rejects.toThrow('envelope.target must be "cloudflare"');

    await fs.writeFile(
      path.join(artifactRoot, 'api/handler.mjs'),
      'export const fetch = () => "drifted";\n',
    );
    await expect(
      verifyMicroVerticalReleaseEnvelope(envelope, { artifactRoot }),
    ).rejects.toThrow('digest does not match final artifact bytes');

    const unknown = JSON.parse(JSON.stringify(envelope));
    unknown.artifacts[0].mutableUrl = 'latest';
    await expect(
      verifyMicroVerticalReleaseEnvelope(unknown, { artifactRoot }),
    ).rejects.toThrow('contains unknown field "mutableUrl"');

    const outsideDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'modern-release-envelope-outside-'),
    );
    tempDirectories.push(outsideDirectory);
    await fs.writeFile(path.join(outsideDirectory, 'outside.mjs'), 'outside');
    await fs.symlink(
      path.join(outsideDirectory, 'outside.mjs'),
      path.join(artifactRoot, 'api/escaped.mjs'),
    );
    const symlinkEscape = createInput(artifactRoot);
    symlinkEscape.artifacts[3].logicalPath = 'api/escaped.mjs';
    symlinkEscape.surfaces.apiBackend = ['api/escaped.mjs'];
    await expect(
      createMicroVerticalReleaseEnvelope(symlinkEscape),
    ).rejects.toThrow('resolves outside artifactRoot');
  });
});
