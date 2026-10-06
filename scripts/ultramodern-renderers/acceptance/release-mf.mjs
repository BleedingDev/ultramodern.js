import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createReleaseArtifactBinding } from '../../ultramodern-production-readiness/published-create-proof/acceptance-contract.mjs';
import {
  createAcceptancePackageManagerEnv,
  createAcceptanceReleaseAgeEnv,
} from '../../ultramodern-production-readiness/published-create-proof/acceptance-profile.mjs';
import { resolveCreatePackage } from '../../ultramodern-production-readiness/published-create-proof/package-cohort.mjs';
import { resolveAcceptanceReleaseAgeExclusions } from '../../ultramodern-production-readiness/published-create-proof/release-age-audit.mjs';
import { releaseConsumerInputs } from '../../ultramodern-production-readiness/react-rsc-worker-proof/contract.mjs';
import { readReleaseManifest } from '../../ultramodern-publish/lib/source-create-proof/release-manifest.mjs';
import { startEphemeralRegistry } from '../../ultramodern-publish/lib/source-create-proof/runtime-proof/registry.mjs';
import { runReactMfRendererGuardProof } from './react-mf-renderer-guard-proof.mjs';
import {
  atomicJson,
  command,
  launch,
  registerArtifact,
  removeOwnedLeaf,
  sha256,
  sourceEvidence,
  within,
} from './release-support.mjs';

const rendererGuardProofSource = new URL(
  './react-mf-renderer-guard-proof.mjs',
  import.meta.url,
);

const shared = `const shared = Object.fromEntries(['react', 'react-dom', 'react-dom/client', '@modern-js/runtime'].map(name => [name, { singleton: true, requiredVersion: require(name === 'react-dom/client' ? 'react-dom/package.json' : name + '/package.json').version, treeShaking: false }]));`;
const remoteSource = `import { useEffect, useRef, useState } from 'react';
export default function Proof() {
  const invocationCount = useRef(0);
  invocationCount.current += 1;
  const root = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  useEffect(() => { root.current?.setAttribute('data-native-hydrated', 'true'); }, []);
  return <div ref={root} id="native-remote-proof" data-native-invocations={invocationCount.current}><span>native-C2-remote-body</span><button id="native-remote-count" onClick={() => setCount(value => value + 1)}>count:{count}</button></div>;
}
`;
const hostSource = `import { lazy, Suspense, type ComponentType } from 'react';
import { loadRemote } from '@module-federation/modern-js-v3/runtime';
const Remote = lazy(async () => {
  const module = await loadRemote<{default: ComponentType}>('c2Remote/Proof');
  if (!module) throw new Error('Native C2 remote is absent');
  return module;
});
export default function App() { return <main id="native-host-proof"><Suspense fallback={<p id="native-remote-pending">pending</p>}><Remote /></Suspense></main>; }
`;

async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const value = server.address().port;
  await new Promise((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve())),
  );
  return value;
}
function packageDirectory(require, specifier, expectedName) {
  let directory = path.dirname(fs.realpathSync(require.resolve(specifier)));
  for (;;) {
    const manifest = path.join(directory, 'package.json');
    if (
      fs.existsSync(manifest) &&
      JSON.parse(fs.readFileSync(manifest)).name === expectedName
    )
      return directory;
    const parent = path.dirname(directory);
    assert.notEqual(parent, directory, `Missing installed ${expectedName}`);
    directory = parent;
  }
}
async function ready(handle, url, signal) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    signal?.throwIfAborted();
    if (handle.failure) throw handle.failure;
    const exited = await Promise.race([
      handle.closed.then(() => true),
      delay(1).then(() => false),
    ]);
    assert(!exited, `Native MF server exited; ${handle.log}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }
    } catch {
      /* bounded startup readiness only */
    }
    await delay(250, undefined, { signal });
  }
  throw new Error(`Native MF server readiness timed out: ${url}`);
}
function fixtureConfig(portNumber, origin) {
  return `import { defineConfig } from '@modern-js/ultramodern-app-tools';
import { moduleFederationPlugin } from '@module-federation/modern-js-v3';
export default defineConfig({ renderer: 'react', server: { port: ${portNumber}, ssr: { mode: 'stream', moduleFederationAppSSR: true } }, output: { assetPrefix: ${JSON.stringify(`${origin}/`)} }, plugins: [moduleFederationPlugin()] });\n`;
}
function mfConfig(role, remoteOrigin) {
  return `import { createRequire } from 'node:module';
import { createModuleFederationConfig } from '@module-federation/modern-js-v3';
${role === 'remote' ? "import { resolveEffectTsgoCompiler } from '@modern-js/app-tools-extensions/config';\n" : ''}
const require = createRequire(import.meta.url);
${shared}
export default createModuleFederationConfig({ name: '${role === 'host' ? 'c2Host' : 'c2Remote'}', filename: 'remoteEntry.js', bridge: { enableBridgeRouter: false }, ${role === 'host' ? "dts: { consumeTypes: true, generateTypes: false, tsConfigPath: './tsconfig.json' }," : "dts: { displayErrorInTerminal: true, generateTypes: { compilerInstance: resolveEffectTsgoCompiler({ from: import.meta.url }) }, tsConfigPath: './tsconfig.json' },"} ${role === 'host' ? `remotes: { c2Remote: 'c2Remote@${remoteOrigin}/mf-manifest.json' }` : "exposes: { './Proof': './src/Proof.tsx' }"}, shared });\n`;
}

/** Separate actual native host and remote; no existing six-app fixture is changed. */
export async function runFederationProbe(options) {
  let assertionCount = 0;
  const check = new Proxy(assert, {
    apply(target, receiver, args) {
      const value = Reflect.apply(target, receiver, args);
      assertionCount += 1;
      return value;
    },
    get(target, property) {
      const value = Reflect.get(target, property);
      return typeof value === 'function'
        ? (...args) => {
            const result = Reflect.apply(value, target, args);
            assertionCount += 1;
            return result;
          }
        : value;
    },
  });
  const {
    workDir,
    receiptPath,
    binding,
    artifacts,
    qualifiedNode,
    pnpmExecutable,
    storeDir,
    browserExecutable,
    owner,
    ownerPid,
    signal,
  } = options;
  const env = { ...options.env, CI: 'true', FORCE_COLOR: '0' };
  check(within(workDir, receiptPath));
  signal?.throwIfAborted();
  const leaf = path.join(workDir, `target-release-native-mf-${randomUUID()}`);
  fs.mkdirSync(leaf, { recursive: false });
  let registrationAttempted = false;
  const handles = [];
  let browser;
  let failure;
  const receipt = {
    schema: 'bleedingdev.ultramodern.c2-native-mf-proof',
    schemaVersion: 1,
    status: 'running',
    ...binding,
    commands: [],
    owner: { name: owner, pid: ownerPid, root: leaf },
    producer: sourceEvidence(new URL(import.meta.url).pathname),
  };
  try {
    registrationAttempted = true;
    registerArtifact(leaf, { owner, ownerPid, kind: 'build' });
    const release = readReleaseManifest({
      manifestPath: artifacts.manifestPath,
    });
    // This workspace is its own consumer (not the shared generator consumer
    // provisioning already installed), so it needs the same ephemeral local
    // cohort registry and release-age-exclusion policy provision used there
    // (withBareGeneratorProof) instead of resolving against the real registry.
    const registry = await startEphemeralRegistry({
      release,
      releaseDir: path.dirname(artifacts.manifestPath),
      rootDir: path.join(leaf, 'registry'),
      storeDir,
    });
    handles.push({ stop: () => registry.stop() });
    receipt.registry = { url: registry.registryUrl, tool: registry.tool };
    const releaseAgeExclusions = resolveAcceptanceReleaseAgeExclusions({
      release,
      mode: 'source',
    });
    const installEnv = createAcceptanceReleaseAgeEnv(
      createAcceptancePackageManagerEnv(
        leaf,
        registry.env,
        pnpmExecutable,
        env,
        { storeDir },
      ),
      resolveCreatePackage(release),
      releaseAgeExclusions,
      registry.env,
    );
    const mf = new Map(
      createReleaseArtifactBinding(release).moduleFederation.map(item => [
        item.packageName,
        item.version,
      ]),
    );
    check(mf.has('@module-federation/modern-js-v3'));
    const templatePath = new URL(
      '../../ultramodern-production-readiness/react-rsc-worker-proof/fixture/package.json.template',
      import.meta.url,
    );
    const template = JSON.parse(fs.readFileSync(templatePath));
    delete template.dependencies['server-only'];
    delete template.devDependencies['@typescript/native-preview'];
    for (const name of ['@effect/tsgo', '@typescript/native']) {
      const specifier = release.createPackage.packageJson.dependencies[name];
      check.equal(typeof specifier, 'string');
      check(specifier.length > 0);
      template.devDependencies[name] = specifier;
    }
    const nativeMfSpecifier =
      release.createPackage.packageJson.dependencies[
        '@module-federation/modern-js-v3'
      ];
    const nativeMfVersion =
      /^npm:(?:@[^/]+\/[^@]+|[^@]+)@(.+)$/u.exec(nativeMfSpecifier)?.[1] ??
      nativeMfSpecifier;
    check.equal(nativeMfVersion, mf.get('@module-federation/modern-js-v3'));
    // Retain the authenticated generator's actual published alias; stripping
    // it to a version would silently choose different native MF package bytes.
    template.dependencies['@module-federation/modern-js-v3'] =
      nativeMfSpecifier;
    receipt.nativeDependency = {
      canonicalName: '@module-federation/modern-js-v3',
      declaredSpecifier: nativeMfSpecifier,
      version: nativeMfVersion,
      owner: release.createPackage.targetName,
      ownerArtifactSha256: release.createPackage.sha256,
    };
    const inputs = releaseConsumerInputs(release, template);
    check(/^packages: \[\]\n/mu.test(inputs.workspaceYaml));
    fs.writeFileSync(
      path.join(leaf, 'pnpm-workspace.yaml'),
      inputs.workspaceYaml.replace(
        /^packages: \[\]\n/mu,
        'packages:\n  - host\n  - remote\n',
      ),
    );
    atomicJson(path.join(leaf, 'package.json'), {
      private: true,
      name: '@ultramodern-proof/c2-native-mf-workspace',
      packageManager: inputs.manifest.packageManager,
    });
    const ports = { host: await port(), remote: await port() };
    check.notEqual(ports.host, ports.remote);
    const origins = Object.fromEntries(
      Object.entries(ports).map(([role, value]) => [
        role,
        `http://127.0.0.1:${value}`,
      ]),
    );
    const roots = {};
    for (const role of ['host', 'remote']) {
      const root = path.join(leaf, role);
      roots[role] = root;
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      atomicJson(path.join(root, 'package.json'), {
        ...inputs.manifest,
        name: `@ultramodern-proof/c2-native-mf-${role}`,
      });
      atomicJson(path.join(root, 'tsconfig.json'), {
        extends: '@modern-js/tsconfig/base',
        compilerOptions: {
          strict: true,
          jsx: 'preserve',
          moduleResolution: 'Bundler',
        },
        include: ['src', 'modern.config.ts', 'module-federation.config.ts'],
      });
      fs.writeFileSync(
        path.join(root, 'modern.config.ts'),
        fixtureConfig(ports[role], origins[role]),
      );
      fs.writeFileSync(
        path.join(root, 'module-federation.config.ts'),
        mfConfig(role, origins.remote),
      );
      fs.writeFileSync(
        path.join(root, 'src/modern-app-env.d.ts'),
        '/// <reference types="@modern-js/ultramodern-app-tools/react-types" />\n',
      );
      fs.writeFileSync(
        path.join(root, 'src/App.tsx'),
        role === 'host' ? hostSource : "export { default } from './Proof';\n",
      );
      if (role === 'remote')
        fs.writeFileSync(path.join(root, 'src/Proof.tsx'), remoteSource);
    }
    receipt.fixture = Object.fromEntries(
      Object.entries(roots).map(([role, root]) => [
        role,
        [
          'package.json',
          'tsconfig.json',
          'modern.config.ts',
          'module-federation.config.ts',
          'src/modern-app-env.d.ts',
          'src/App.tsx',
          ...(role === 'remote' ? ['src/Proof.tsx'] : []),
        ].map(file => sourceEvidence(path.join(root, file))),
      ]),
    );
    receipt.workspaceInputs = ['package.json', 'pnpm-workspace.yaml'].map(
      file => sourceEvidence(path.join(leaf, file)),
    );
    receipt.commands.push(
      await command(
        pnpmExecutable,
        ['install', '--store-dir', storeDir, '--strict-peer-dependencies'],
        {
          cwd: leaf,
          log: path.join(workDir, `${path.basename(leaf)}-install.log`),
          env: {
            ...env,
            ...installEnv,
            npm_config_store_dir: storeDir,
            pnpm_config_store_dir: storeDir,
            npm_config_cache: path.join(leaf, 'npm-cache'),
          },
          timeoutMs: 600000,
          signal,
        },
      ),
    );
    receipt.lockfile = sourceEvidence(path.join(leaf, 'pnpm-lock.yaml'));
    receipt.builds = {};
    receipt.installed = {};
    for (const role of ['remote', 'host']) {
      const root = roots[role];
      const require = createRequire(path.join(root, 'package.json'));
      const sdkName = release.aliases['@modern-js/ultramodern-app-tools'];
      const sdkDirectory = packageDirectory(
        require,
        '@modern-js/ultramodern-app-tools',
        sdkName,
      );
      const sdkManifest = JSON.parse(
        fs.readFileSync(path.join(sdkDirectory, 'package.json')),
      );
      check.equal(sdkManifest.version, binding.releaseVersion);
      const cli = path.resolve(sdkDirectory, sdkManifest.bin.ultramodern);
      receipt.commands.push(
        await command(qualifiedNode, [cli, 'build'], {
          cwd: root,
          log: path.join(workDir, `${path.basename(leaf)}-${role}-build.log`),
          env,
          timeoutMs: 600000,
          signal,
        }),
      );
      const metadataInput = path.join(
        workDir,
        `${path.basename(leaf)}-${role}-metadata-input.json`,
      );
      const metadataOutput = path.join(
        workDir,
        `${path.basename(leaf)}-${role}-metadata.json`,
      );
      atomicJson(metadataInput, {
        applicationRoot: root,
        consumerRoot: leaf,
        role,
        manifestPath: artifacts.manifestPath,
        expectedSourceRevision: binding.sourceRevision,
        exactPackages: inputs.exactPackages,
      });
      receipt.commands.push(
        await command(
          qualifiedNode,
          [
            new URL('./release-mf-metadata.mjs', import.meta.url).pathname,
            metadataInput,
            metadataOutput,
          ],
          {
            cwd: root,
            env,
            log: path.join(
              workDir,
              `${path.basename(leaf)}-${role}-metadata.log`,
            ),
            timeoutMs: 120000,
            signal,
          },
        ),
      );
      const observed = JSON.parse(fs.readFileSync(metadataOutput));
      receipt.builds[role] = observed.build;
      receipt.installed[role] = observed.installed;
      const handle = launch(qualifiedNode, [cli, 'serve'], {
        cwd: root,
        log: path.join(workDir, `${path.basename(leaf)}-${role}-serve.log`),
        env: { ...env, NODE_ENV: 'production', PORT: String(ports[role]) },
        signal,
      });
      handles.push(handle);
      await ready(
        handle,
        role === 'remote'
          ? `${origins.remote}/mf-manifest.json`
          : `${origins.host}/`,
        signal,
      );
    }
    const mfResponse = await fetch(`${origins.remote}/mf-manifest.json`, {
      signal: AbortSignal.timeout(30000),
    });
    check.equal(mfResponse.status, 200);
    const mfBytes = Buffer.from(await mfResponse.arrayBuffer());
    receipt.nativeManifest = {
      status: 200,
      url: mfResponse.url,
      byteLength: mfBytes.length,
      sha256: sha256(mfBytes),
      value: JSON.parse(mfBytes),
    };
    const response = await fetch(`${origins.host}/`, {
      signal: AbortSignal.timeout(30000),
    });
    check.equal(response.status, 200);
    const html = await response.text();
    check(
      html.includes('native-C2-remote-body'),
      'Actual native MF component must server-render',
    );
    const ssrCount = Number(/data-native-invocations="(\d+)"/u.exec(html)?.[1]);
    check(Number.isInteger(ssrCount) && ssrCount >= 1);
    check(!html.includes('data-native-hydrated="true"'));
    const documentIdentity = JSON.parse(
      /id="ultramodern-renderer-identity"[^>]*>(.*?)<\/script>/su.exec(
        html,
      )?.[1] ?? 'null',
    );
    check.deepEqual(documentIdentity, receipt.builds.host.identity);
    check.deepEqual(
      JSON.parse(response.headers.get('x-ultramodern-renderer-identity')),
      documentIdentity,
    );
    receipt.ssr = {
      status: response.status,
      url: response.url,
      sha256: sha256(html),
      byteLength: Buffer.byteLength(html),
      remoteInvocationCount: ssrCount,
      rendererIdentity: documentIdentity,
    };
    const require = createRequire(
      path.join(options.browserDependencyRoot, 'package.json'),
    );
    const { chromium } = require('playwright-core');
    receipt.browserDriver = {
      manifest: sourceEvidence(require.resolve('playwright-core/package.json')),
      version: require('playwright-core/package.json').version,
      executable: sourceEvidence(browserExecutable),
    };
    browser = await chromium.launch({
      executablePath: browserExecutable,
      headless: true,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    const network = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('response', result => {
      if (result.url().startsWith(origins.remote))
        network.push({ url: result.url(), status: result.status() });
    });
    await page.addInitScript(() => {
      let first;
      const observer = new MutationObserver(records => {
        // Parser insertion records retain the original SSR node even when an
        // ancestor already contains a replacement by callback time.
        for (const record of records)
          for (const node of record.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.id === 'native-remote-proof') first ??= node;
          }
        if (first) return;
        for (const record of records)
          for (const node of record.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            first ??= node.querySelector('#native-remote-proof');
          }
      });
      observer.observe(document, { childList: true, subtree: true });
      Object.defineProperty(window, '__c2NativeRemoteDom', {
        value: () => first === document.getElementById('native-remote-proof'),
      });
    });
    const navigation = await page.goto(`${origins.host}/`, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    check.equal(navigation.status(), 200);
    const browserDocumentBytes = await navigation.body();
    const browserDocumentHtml = browserDocumentBytes.toString('utf8');
    check(browserDocumentHtml.includes('native-C2-remote-body'));
    const browserDocumentInvocationCount = Number(
      /data-native-invocations="(\d+)"/u.exec(browserDocumentHtml)?.[1],
    );
    check(
      Number.isInteger(browserDocumentInvocationCount) &&
        browserDocumentInvocationCount > 0,
    );
    check.deepEqual(
      JSON.parse(navigation.headers()['x-ultramodern-renderer-identity']),
      receipt.builds.host.identity,
    );
    await page.waitForSelector(
      '#native-remote-proof[data-native-hydrated="true"]',
      { timeout: 60000 },
    );
    const firstCount = Number(
      await page
        .locator('#native-remote-proof')
        .getAttribute('data-native-invocations'),
    );
    check(firstCount >= 1);
    check.equal(
      await page.locator('#native-remote-count').textContent(),
      'count:0',
    );
    await page.locator('#native-remote-count').click();
    await page.waitForFunction(
      () =>
        document.getElementById('native-remote-count')?.textContent ===
        'count:1',
    );
    const afterClickCount = Number(
      await page
        .locator('#native-remote-proof')
        .getAttribute('data-native-invocations'),
    );
    check(
      afterClickCount > firstCount,
      'Native remote body must execute again after its own React event',
    );
    check.equal(
      await page.evaluate(() => window.__c2NativeRemoteDom()),
      true,
      'Actual native hydration must retain its SSR element',
    );
    check(
      network.some(
        row => row.url.includes('mf-manifest.json') && row.status === 200,
      ),
    );
    check(
      network.some(
        row => row.url.includes('remoteEntry') && row.status === 200,
      ),
    );
    check(network.every(row => row.status < 400));
    check.deepEqual(errors, []);
    check(
      [
        ...Object.values(receipt.fixture).flat(),
        ...receipt.workspaceInputs,
      ].every(file => sourceEvidence(file.path).sha256 === file.sha256),
      'Authored native federation inputs changed during qualification',
    );
    receipt.browser = {
      document: {
        url: navigation.url(),
        status: navigation.status(),
        sha256: sha256(browserDocumentBytes),
        byteLength: browserDocumentBytes.length,
        remoteInvocationCount: browserDocumentInvocationCount,
        rendererIdentity: receipt.builds.host.identity,
      },
      hydrated: true,
      retainedSsrElement: true,
      firstInvocationCount: firstCount,
      afterClickInvocationCount: afterClickCount,
      nativeEventValue: 1,
      errors,
      network,
    };
    receipt.observations = {
      assertionCount,
      hostRenderer: 'react',
      remoteRenderer: 'react',
      remoteInvocationCount:
        ssrCount + browserDocumentInvocationCount + afterClickCount,
      ssrRendered: true,
      hydrated: true,
      invocationMeasurement:
        'Remote component instance useRef counter increments exclusively inside its native React component body. The separate HTTP SSR request, actual browser document SSR request and hydrated browser instance are summed; readiness requests and unobserved renders are excluded.',
    };
    const rendererGuardReceiptPath = path.resolve(
      path.dirname(receiptPath),
      `${path.basename(receiptPath, '.json')}-renderer-guard-proof.json`,
    );
    const rendererGuardProof = (receipt.rendererGuardProof = {
      status: 'running',
      receiptPath: rendererGuardReceiptPath,
      inputs: {
        hostApp: path.resolve(roots.host),
        remoteApp: path.resolve(roots.remote),
        hostManifest: `${origins.host}/mf-manifest.json`,
        remoteManifest: `${origins.remote}/mf-manifest.json`,
        output: rendererGuardReceiptPath,
        sdkImport: '@modern-js/ultramodern-app-tools',
      },
    });
    let newRendererGuardReceipt = false;
    try {
      rendererGuardProof.producer = sourceEvidence(
        rendererGuardProofSource.pathname,
      );
      assert(
        !fs.existsSync(rendererGuardReceiptPath),
        'Renderer guard proof needs a new sibling receipt',
      );
      newRendererGuardReceipt = true;
      rendererGuardProof.receipt = await runReactMfRendererGuardProof(
        rendererGuardProof.inputs,
      );
      rendererGuardProof.evidence = rendererGuardProof.receipt.evidence;
      rendererGuardProof.artifact = sourceEvidence(rendererGuardReceiptPath);
      assert.equal(rendererGuardProof.receipt.observations.length, 19);
      assert.equal(rendererGuardProof.evidence.rejectedBeforeEntry, 16);
      assert.equal(rendererGuardProof.evidence.acceptedToNativeEntry, 3);
      assert.equal(rendererGuardProof.evidence.remoteEntryEvaluation, 0);
      assert.equal(rendererGuardProof.evidence.remoteFactoryExecution, 0);
      rendererGuardProof.status = 'passed';
    } catch (error) {
      rendererGuardProof.status = 'failed';
      rendererGuardProof.failure = {
        message: error?.message ?? String(error),
        stack: error?.stack,
      };
      if (error?.receipt !== undefined)
        rendererGuardProof.receipt ??= error.receipt;
      rendererGuardProof.evidence ??=
        error?.evidence ?? rendererGuardProof.receipt?.evidence;
      if (newRendererGuardReceipt && fs.existsSync(rendererGuardReceiptPath)) {
        try {
          rendererGuardProof.artifact ??= sourceEvidence(
            rendererGuardReceiptPath,
          );
          rendererGuardProof.receipt ??= JSON.parse(
            fs.readFileSync(rendererGuardReceiptPath, 'utf8'),
          );
          rendererGuardProof.evidence ??= rendererGuardProof.receipt?.evidence;
        } catch (evidenceError) {
          rendererGuardProof.evidenceReadFailure = {
            message: evidenceError.message,
            stack: evidenceError.stack,
          };
        }
      }
      throw error;
    }
  } catch (error) {
    failure = error;
  }
  const cleanupErrors = [];
  if (browser)
    try {
      await browser.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  for (const handle of handles.reverse())
    try {
      await handle.stop();
    } catch (error) {
      cleanupErrors.push(error);
    }
  if (!cleanupErrors.length) {
    try {
      if (registrationAttempted)
        receipt.cleanup = await removeOwnedLeaf(leaf, { owner });
      else {
        fs.rmSync(leaf, { recursive: true });
        receipt.cleanup = { path: leaf, removed: true, registered: false };
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  receipt.status = failure || cleanupErrors.length ? 'failed' : 'passed';
  if (signal?.aborted) {
    failure ??=
      signal.reason ?? new Error('Native federation probe interrupted');
    receipt.status = 'failed';
  }
  if (failure)
    receipt.failure = { message: failure.message, stack: failure.stack };
  receipt.cleanupErrors = cleanupErrors.map(error => error.message);
  atomicJson(receiptPath, receipt);
  if (failure && cleanupErrors.length)
    throw new AggregateError(
      [failure, ...cleanupErrors],
      'Native federation proof and cleanup failed',
    );
  if (failure) throw failure;
  if (cleanupErrors.length)
    throw new AggregateError(
      cleanupErrors,
      'Native federation proof cleanup failed',
    );
  return receipt;
}
