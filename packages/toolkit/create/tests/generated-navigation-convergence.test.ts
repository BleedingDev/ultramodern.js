import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runUltramodernToolingCli } from '../src/ultramodern-tooling/commands';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import { regenerateGeneratedNavigationSurface } from '../src/ultramodern-workspace/demo-components';

const fixturesDir = path.join(__dirname, 'fixtures/tractor-navigation');

const shellFramePath = 'apps/shell-super-app/src/routes/shell-frame.tsx';
const checkoutAddToCartPath =
  'verticals/checkout/src/components/add-to-cart.tsx';
const checkoutPagePath = 'verticals/checkout/src/components/checkout-page.tsx';

function scaffoldWorkspace(name: string, includeCheckout = false) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-navigation-'));
  const workspaceDir = path.join(tempRoot, name);
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: name,
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: { strategy: 'workspace' },
  });
  if (includeCheckout) {
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'checkout',
      modernVersion: '3.2.1',
    });
  }
  return { tempRoot, workspaceDir };
}

function readText(workspaceDir: string, relativePath: string) {
  return fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8');
}

function readJson(workspaceDir: string, relativePath: string) {
  return JSON.parse(readText(workspaceDir, relativePath));
}

function writeJson(workspaceDir: string, relativePath: string, value: unknown) {
  fs.writeFileSync(
    path.join(workspaceDir, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function installFixture(
  workspaceDir: string,
  relativePath: string,
  fixtureRelativePath = relativePath,
) {
  const destination = path.join(workspaceDir, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(
    path.join(fixturesDir, `${fixtureRelativePath}.snap`),
    destination,
  );
}

test('fresh generation emits native TanStack shell and demo navigation', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'fresh-navigation',
    true,
  );

  try {
    const shellFrame = readText(workspaceDir, shellFramePath);
    assert.match(
      shellFrame,
      /import \{ useNavigate \} from '@modern-js\/plugin-tanstack\/runtime';/u,
    );
    assert.match(shellFrame, /const navigate = useNavigate\(\);/u);
    assert.match(shellFrame, /void navigate\(\{ to: target \}\);/u);
    assert.doesNotMatch(shellFrame, /window\s*\.\s*location/u);

    const checkoutHome = readText(
      workspaceDir,
      'verticals/checkout/src/routes/[lang]/page.tsx',
    );
    assert.match(
      checkoutHome,
      /import \{ Link \} from '@modern-js\/plugin-tanstack\/runtime';/u,
    );
    assert.match(checkoutHome, /<Link[\s\S]*?to="\/\$lang"/u);
    assert.doesNotMatch(checkoutHome, /<a\b[\s\S]{0,512}?preventDefault/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate regenerates the manifest-owned Tractor shell navigation only', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'migrate-shell-navigation',
  );

  try {
    installFixture(workspaceDir, shellFramePath);
    const shellFrameFile = path.join(workspaceDir, shellFramePath);
    fs.writeFileSync(
      shellFrameFile,
      readText(workspaceDir, shellFramePath).replace(
        '      {children}\n',
        '      <a href="/en" onClick={event => { event.preventDefault(); }}>Home</a>\n      {children}\n',
      ),
      'utf-8',
    );

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const migrated = readText(workspaceDir, shellFramePath);
    assert.match(
      migrated,
      /import \{ Link, useLocation, useNavigate \} from '@modern-js\/plugin-tanstack\/runtime';/u,
    );
    assert.match(migrated, /const navigate = useNavigate\(\);/u);
    assert.match(
      migrated,
      /void navigate\(\{\s*to: `\$\{localizedPath\(location\.pathname, nextLanguage\)\}\$\{suffix\}`,\s*\}\);/u,
    );
    assert.doesNotMatch(migrated, /window\s*\.\s*location/u);
    assert.match(
      migrated,
      /shell:max-w-\[calc\(1000px\+var\(--outer-space\)\*2\)\]/u,
    );
    assert.match(migrated, /<BoundaryOverlay \/>/u);
    assert.match(migrated, /<Footer \/>/u);
    assert.match(migrated, /<Link to="\/en">Home<\/Link>/u);
    assert.doesNotMatch(migrated, /preventDefault/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('migrate requires delivery-unit and package-export ownership for the Tractor checkout surface', async () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'migrate-checkout-navigation',
    true,
  );

  try {
    const compactPath = '.modernjs/ultramodern.json';
    const compact = readJson(workspaceDir, compactPath);
    const checkout = compact.topology.apps.find(
      (app: { id?: string }) => app.id === 'checkout',
    );
    assert.ok(checkout?.deliveryUnit);
    checkout.moduleFederation.exposes.push('./CheckoutPage');
    writeJson(workspaceDir, compactPath, compact);

    const packagePath = 'verticals/checkout/package.json';
    const packageJson = readJson(workspaceDir, packagePath);
    delete packageJson.exports['./CheckoutPage'];
    writeJson(workspaceDir, packagePath, packageJson);

    installFixture(workspaceDir, checkoutPagePath);
    const userOwnedPath =
      'verticals/checkout/src/components/user-checkout-page.tsx';
    installFixture(workspaceDir, userOwnedPath, checkoutPagePath);
    const staleCheckout = readText(workspaceDir, checkoutPagePath);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );
    assert.equal(readText(workspaceDir, checkoutPagePath), staleCheckout);

    const ownedPackageJson = readJson(workspaceDir, packagePath);
    ownedPackageJson.exports['./CheckoutPage'] =
      './src/components/checkout-page.tsx';
    writeJson(workspaceDir, packagePath, ownedPackageJson);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );

    const migrated = readText(workspaceDir, checkoutPagePath);
    assert.match(
      migrated,
      /import \{ Form, Link, useNavigate \} from '@modern-js\/plugin-tanstack\/runtime';/u,
    );
    assert.match(migrated, /const navigate = useNavigate\(\);/u);
    assert.match(migrated, /<Form[\s\S]*?onSubmit=\{submitOrder\}/u);
    assert.match(migrated, /<Link[\s\S]*?to=\{`\/\$\{language\}\/tractors`\}/u);
    assert.doesNotMatch(migrated, /window\s*\.\s*location|<form\b|<a\b/u);
    assert.match(migrated, /const order = cart\.placeOrder\(\);/u);
    assert.match(migrated, /checkout:tracking-\[0\.42em\]/u);
    assert.equal(readText(workspaceDir, userOwnedPath), staleCheckout);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated and migrated Tractor add-to-cart navigation converge idempotently', async () => {
  const fixturePath = path.join(fixturesDir, `${checkoutAddToCartPath}.snap`);
  const legacy = fs.readFileSync(fixturePath, 'utf-8');
  const generated = regenerateGeneratedNavigationSurface(
    legacy,
    'demo-component',
  );

  assert.match(
    generated,
    /import \{ Link \} from '@modern-js\/plugin-tanstack\/runtime';/u,
  );
  assert.match(generated, /<Link\b/u);
  assert.match(generated, /to=\{`\/\$\{language\}\/cart\?sku=\$\{sku\}`\}/u);
  assert.match(generated, /cart\.addProduct\(\{/u);
  assert.doesNotMatch(generated, /<a\b[\s\S]*?\bonClick=/u);
  assert.doesNotMatch(generated, /preventDefault|window\s*\.\s*location/u);
  assert.match(generated, /data-modern-mf-expose="\.\/AddToCart"/u);
  assert.match(generated, /t\('checkout\.actions\.addToCart'\)/u);
  for (const className of legacy.matchAll(/className="[^"]+"/gu)) {
    assert.ok(generated.includes(className[0]));
  }
  assert.equal(
    regenerateGeneratedNavigationSurface(generated, 'demo-component'),
    generated,
  );

  const { tempRoot, workspaceDir } = scaffoldWorkspace(
    'migrate-add-to-cart-navigation',
    true,
  );

  try {
    const compactPath = '.modernjs/ultramodern.json';
    const compact = readJson(workspaceDir, compactPath);
    const checkout = compact.topology.apps.find(
      (app: { id?: string }) => app.id === 'checkout',
    );
    assert.ok(checkout?.deliveryUnit);
    checkout.moduleFederation.exposes.push('./AddToCart');
    writeJson(workspaceDir, compactPath, compact);

    const packagePath = 'verticals/checkout/package.json';
    const packageJson = readJson(workspaceDir, packagePath);
    packageJson.exports['./AddToCart'] = './src/components/add-to-cart.tsx';
    writeJson(workspaceDir, packagePath, packageJson);
    installFixture(workspaceDir, checkoutAddToCartPath);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );
    assert.equal(readText(workspaceDir, checkoutAddToCartPath), generated);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceDir,
      ),
      0,
    );
    assert.equal(readText(workspaceDir, checkoutAddToCartPath), generated);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
