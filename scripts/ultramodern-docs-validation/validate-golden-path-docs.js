#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

const paths = {
  docsEn: 'packages/document/docs/en/guides/get-started/ultramodern.mdx',
  docsZh: 'packages/document/docs/zh/guides/get-started/ultramodern.mdx',
  singleAppPackage: 'packages/toolkit/create/template/package.json.handlebars',
  singleAppReadme: 'packages/toolkit/create/template/README.md',
  workspaceReadme:
    'packages/toolkit/create/template-workspace/README.md.handlebars',
  createCli: 'packages/toolkit/create/src/index.ts',
  workspaceGenerator: 'packages/toolkit/create/src/ultramodern-workspace.ts',
};

const pnpmBuiltins = new Set(['install', 'dlx', 'exec']);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function extractCodeBlocks(markdown) {
  return [...markdown.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/g)].map(match =>
    normalizeCommandBlock(match[1]),
  );
}

function normalizeCommandBlock(block) {
  return block
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .join('\n');
}

function extractPnpmScriptInvocations(commandBlock) {
  const invocations = [];
  for (const line of commandBlock.split('\n')) {
    for (const match of line.matchAll(
      /(?:^|[;&|]\s*|--\s*)pnpm(?:\s+run)?\s+([^\s]+)/g,
    )) {
      const script = match[1];
      if (
        script.startsWith('-') ||
        script.includes('/') ||
        pnpmBuiltins.has(script)
      ) {
        continue;
      }
      invocations.push(script);
    }
  }
  return invocations;
}

function extractCreateFlags(commandBlock) {
  const flags = [];
  for (const line of commandBlock.split('\n')) {
    if (!line.includes('@bleedingdev/modern-js-create')) {
      continue;
    }
    for (const match of line.matchAll(/--[a-z0-9-]+/g)) {
      flags.push(match[0]);
    }
  }
  return flags;
}

function extractTemplatePackageScripts(packageTemplate) {
  const scriptsStart = packageTemplate.indexOf('"scripts": {');
  assert(
    scriptsStart >= 0,
    'single-app template package.json has no scripts block',
  );
  const scriptsEnd = packageTemplate.indexOf(
    '\n  },\n  "dependencies"',
    scriptsStart,
  );
  assert(
    scriptsEnd > scriptsStart,
    'single-app template package.json scripts block could not be bounded',
  );

  const scriptsBlock = packageTemplate.slice(scriptsStart, scriptsEnd);
  return new Set(
    [...scriptsBlock.matchAll(/"([^"]+)":\s*"/g)].map(match => match[1]),
  );
}

function extractWorkspaceRootScripts(workspaceSource) {
  const rootPackageStart = workspaceSource.indexOf(
    'function createRootPackageJson',
  );
  assert(
    rootPackageStart >= 0,
    'workspace generator has no createRootPackageJson function',
  );
  const scriptsStart = workspaceSource.indexOf('scripts: {', rootPackageStart);
  assert(scriptsStart >= 0, 'workspace root package has no scripts block');
  const scriptsEnd = workspaceSource.indexOf(
    '\n    },\n    engines:',
    scriptsStart,
  );
  assert(
    scriptsEnd > scriptsStart,
    'workspace root package scripts block could not be bounded',
  );

  const scriptsBlock = workspaceSource.slice(scriptsStart, scriptsEnd);
  return new Set(
    [...scriptsBlock.matchAll(/^\s*(?:'([^']+)'|([A-Za-z0-9_:-]+))\s*:/gm)]
      .map(match => match[1] || match[2])
      .filter(Boolean),
  );
}

function assertScriptCommandsExist(label, commandBlocks, generatedScripts) {
  const missing = [];
  for (const commandBlock of commandBlocks) {
    for (const script of extractPnpmScriptInvocations(commandBlock)) {
      if (!generatedScripts.has(script)) {
        missing.push(script);
      }
    }
  }
  assert(
    missing.length === 0,
    `${label} references pnpm scripts that are not generated: ${[
      ...new Set(missing),
    ].join(', ')}`,
  );
}

function assertCreateFlagsExist(label, commandBlocks, createCliSource) {
  const missing = [];
  for (const commandBlock of commandBlocks) {
    for (const flag of extractCreateFlags(commandBlock)) {
      if (!createCliSource.includes(flag)) {
        missing.push(flag);
      }
    }
  }
  assert(
    missing.length === 0,
    `${label} references create flags that are not registered: ${[
      ...new Set(missing),
    ].join(', ')}`,
  );
}

function assertIncludesAll(label, content, snippets) {
  const missing = snippets.filter(snippet => !content.includes(snippet));
  assert(
    missing.length === 0,
    `${label} is missing golden-path command snippets: ${missing.join(', ')}`,
  );
}

function main() {
  const docsEn = read(paths.docsEn);
  const docsZh = read(paths.docsZh);
  const singleAppReadme = read(paths.singleAppReadme);
  const workspaceReadme = read(paths.workspaceReadme);
  const createSources = `${read(paths.createCli)}\n${read(paths.workspaceGenerator)}`;

  const singleAppScripts = extractTemplatePackageScripts(
    read(paths.singleAppPackage),
  );
  const workspaceScripts = extractWorkspaceRootScripts(
    read(paths.workspaceGenerator),
  );
  const generatedScripts = new Set([...singleAppScripts, ...workspaceScripts]);

  const docsEnBlocks = extractCodeBlocks(docsEn);
  const docsZhBlocks = extractCodeBlocks(docsZh);
  assert(
    JSON.stringify(docsEnBlocks) === JSON.stringify(docsZhBlocks),
    'English and Chinese UltraModern golden-path command blocks diverged',
  );

  assertIncludesAll('English UltraModern guide', docsEn, [
    'mise exec -- pnpm ultramodern:check',
    'pnpm dlx @bleedingdev/modern-js-create my-super-app --ultramodern-workspace',
    'mise exec -- pnpm check',
    'mise exec -- pnpm cloudflare:build',
    'mise exec -- pnpm cloudflare:proof -- --require-public-urls',
  ]);
  assertIncludesAll('Chinese UltraModern guide', docsZh, [
    'mise exec -- pnpm ultramodern:check',
    'pnpm dlx @bleedingdev/modern-js-create my-super-app --ultramodern-workspace',
    'mise exec -- pnpm check',
    'mise exec -- pnpm cloudflare:build',
    'mise exec -- pnpm cloudflare:proof -- --require-public-urls',
  ]);
  assertIncludesAll('Generated single-app README', singleAppReadme, [
    'pnpm run ultramodern:check',
    'MODERN_PUBLIC_SITE_URL=https://example.com pnpm run build',
  ]);
  assertIncludesAll('Generated workspace README', workspaceReadme, [
    'pnpm check',
    'pnpm build',
    'pnpm cloudflare:proof -- --require-public-urls',
  ]);

  const publicDocBlocks = [...docsEnBlocks, ...docsZhBlocks];
  const generatedReadmeBlocks = [
    ...extractCodeBlocks(singleAppReadme),
    ...extractCodeBlocks(workspaceReadme),
  ];

  assertScriptCommandsExist(
    'public UltraModern docs',
    publicDocBlocks,
    generatedScripts,
  );
  assertScriptCommandsExist(
    'generated UltraModern READMEs',
    generatedReadmeBlocks,
    generatedScripts,
  );
  assertCreateFlagsExist(
    'public UltraModern docs',
    publicDocBlocks,
    createSources,
  );
  assertCreateFlagsExist(
    'generated UltraModern READMEs',
    generatedReadmeBlocks,
    createSources,
  );

  console.log(
    JSON.stringify(
      {
        status: 'passed',
        docs: [paths.docsEn, paths.docsZh],
        generatedReadmes: [paths.singleAppReadme, paths.workspaceReadme],
        generatedScriptCount: generatedScripts.size,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
