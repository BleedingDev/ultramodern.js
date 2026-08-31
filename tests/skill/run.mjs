#!/usr/bin/env node
// 验证 modernjs-migrate-to-v3 skill。fixture 分三层（详见各 fixture 的 PROVENANCE.md）：
//   A. 真实自动迁移 baseline：real-v2-generator-app（generator 默认 defineConfig 形态）
//   B. origin/v2 integration 真实形态（applyBaseConfig 包装）：real-v2-bff-hono /
//      real-v2-server-config / real-v2-tailwindcss-v2 —— 验证结构性迁移进 manual、不假成功
//   C. 存量 / 防御 / blocker edge：legacy-v2-app-config + v2-edge-*
// 断言区分 provenance（来源结构不被改坏）、automated（应自动迁的内容）、manual（应进人工的内容）。
//   node tests/skill/run.mjs   —— 退出码非 0 表示有断言失败。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SCRIPTS = path.join(REPO, 'skills/modernjs-migrate-to-v3/scripts');
const { transformSync } = createRequire(
  path.join(REPO, 'packages/toolkit/ultramodern-create/package.json'),
)('esbuild');
const tmpDirs = [];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}`);
  }
}

function compileModule(file) {
  const source = fs.readFileSync(file, 'utf8');
  const extension = path.extname(file);
  const loader =
    extension === '.tsx' ? 'tsx' : extension === '.ts' ? 'ts' : 'js';
  return transformSync(source, {
    format: 'cjs',
    jsx: 'automatic',
    loader,
    platform: 'node',
    sourcefile: file,
    target: 'node12',
  }).code;
}

function compileProject(root) {
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(file);
      } else if (/\.(?:[cm]?[jt]s|tsx)$/.test(entry.name)) {
        compileModule(file);
      }
    }
  };
  visit(root);
}

function executeModule(root, rel) {
  const requires = [];
  const calls = [];
  const cache = new Map();
  const fragment = Symbol('Fragment');
  const runtimeContext = { name: 'RuntimeContext' };

  const record =
    (name, implementation = (...args) => ({ name, args })) =>
    (...args) => {
      calls.push({ name, args });
      return implementation(...args);
    };
  const identity = name => record(name, value => value);
  const plugin = name =>
    record(name, options => ({ kind: 'plugin', name, options }));
  const genericModule = request => {
    const values = {
      __esModule: true,
      applyBaseConfig: identity('applyBaseConfig'),
      default: record(`${request}.default`),
    };
    return new Proxy(values, {
      get(target, property) {
        if (property in target) return target[property];
        const value = record(`${request}.${String(property)}`);
        target[property] = value;
        return value;
      },
    });
  };

  const externalModule = request => {
    if (request === '@modern-js/app-tools') {
      return {
        __esModule: true,
        appTools: plugin('appTools'),
        defineConfig: identity('defineConfig'),
      };
    }
    if (request === '@modern-js/core') {
      return { __esModule: true, defineConfig: identity('defineConfig') };
    }
    if (request === '@modern-js/plugin-bff') {
      return { __esModule: true, bffPlugin: plugin('bffPlugin') };
    }
    if (request === '@modern-js/plugin-tailwindcss') {
      const tailwindcssPlugin = plugin('tailwindcssPlugin');
      return {
        __esModule: true,
        default: tailwindcssPlugin,
        tailwindcssPlugin,
      };
    }
    if (request === '@modern-js/plugin-server') {
      return { __esModule: true, serverPlugin: plugin('serverPlugin') };
    }
    if (request === '@modern-js/runtime') {
      return {
        __esModule: true,
        RuntimeContext: runtimeContext,
        defineRuntimeConfig: identity('defineRuntimeConfig'),
        useRuntimeContext: record('useRuntimeContext', () => ({
          context: { request: 'request' },
        })),
      };
    }
    if (request === '@modern-js/runtime/react') {
      return {
        __esModule: true,
        createRoot: record('createRoot', () => function ModernRoot() {}),
      };
    }
    if (request === '@modern-js/runtime/browser') {
      return { __esModule: true, render: record('render', () => undefined) };
    }
    if (request === '@modern-js/server-runtime') {
      return {
        __esModule: true,
        defineServerConfig: identity('defineServerConfig'),
        useHonoContext: record('useHonoContext', () => ({
          req: { path: '/' },
        })),
      };
    }
    if (request === '@modern-js/plugin-bff/client') {
      return {
        __esModule: true,
        configure: record('configure', () => undefined),
        fetchUser: record('fetchUser'),
      };
    }
    if (request === 'react') {
      const react = {
        Fragment: fragment,
        use: record('use', () => ({ context: { request: 'request' } })),
        useContext: record('useContext', () => ({
          context: { request: 'request' },
        })),
        useState: record('useState', initial => [initial, () => undefined]),
      };
      return { __esModule: true, default: react, ...react };
    }
    if (request === 'react/jsx-runtime') {
      return {
        __esModule: true,
        Fragment: fragment,
        jsx: record('jsx', (type, props) => ({ props, type })),
        jsxs: record('jsxs', (type, props) => ({ props, type })),
      };
    }
    return genericModule(request);
  };

  const resolveLocal = (request, parent) => {
    const base = path.resolve(path.dirname(parent), request);
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
      path.join(base, 'index.js'),
    ]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
  };

  const load = file => {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const localRequire = request => {
      requires.push(request);
      if (request.startsWith('.')) {
        const resolved = resolveLocal(request, file);
        if (resolved) return load(resolved);
        if (/applyBaseConfig|existing-plugin|\/plugins$/.test(request)) {
          return genericModule(request);
        }
        throw new Error(`Cannot resolve ${request} from ${file}`);
      }
      if (/\.css$/.test(request)) return {};
      return externalModule(request);
    };
    vm.runInNewContext(
      compileModule(file),
      {
        clearTimeout,
        console,
        exports: module.exports,
        module,
        process,
        require: localRequire,
        setTimeout,
      },
      { filename: file },
    );
    return module.exports;
  };

  const exports = load(path.join(root, rel));
  return {
    calls,
    defaultExport: exports.default ?? exports,
    exports,
    requires,
  };
}

function callsNamed(execution, name) {
  return execution.calls.filter(call => call.name === name);
}

function pluginNames(config) {
  return (config.plugins ?? []).map(value => value.name);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

// 复制某个 fixture 到临时目录并跑 migrate；返回读取辅助
function prepare(fixture, runMigrate = true) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-migrate-'));
  tmpDirs.push(work);
  copyDir(path.join(HERE, 'fixtures', fixture), work);
  if (runMigrate) {
    execFileSync(
      'node',
      [path.join(SCRIPTS, 'migrate.mjs'), work, '--to=3.0.0'],
      { encoding: 'utf8' },
    );
    compileProject(work);
  }
  return {
    work,
    read: rel => fs.readFileSync(path.join(work, rel), 'utf8'),
    has: rel => fs.existsSync(path.join(work, rel)),
    module: rel => executeModule(work, rel),
    report: () =>
      JSON.parse(
        fs.readFileSync(
          path.join(work, '.agents/runs/modernjs-migrate/report.json'),
          'utf8',
        ),
      ),
  };
}

try {
  // A0. 未显式传 --to 时，默认解析 Modern.js 最新 v3 版本；测试里用 env 注入，避免依赖网络。
  console.log('== A0. default target version resolves latest v3 ==');
  const latest = prepare('real-v2-generator-app', false);
  execFileSync('node', [path.join(SCRIPTS, 'migrate.mjs'), latest.work], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MODERNJS_MIGRATE_LATEST_V3_VERSION: '3.9.9',
    },
  });
  const latestPkg = JSON.parse(latest.read('package.json'));
  const latestReport = latest.report();
  check(
    '[auto] 默认目标版本不再固定 3.0.0，会使用检测到的最新 v3',
    latestPkg.devDependencies['@modern-js/app-tools'] === '3.9.9' &&
      latestPkg.dependencies['@modern-js/runtime'] === '3.9.9',
  );
  check(
    '[auto] report 记录目标版本来源',
    latestReport.toVersion === '3.9.9' &&
      latestReport.targetVersionSource ===
        'env:MODERNJS_MIGRATE_LATEST_V3_VERSION',
  );

  // ============================================================
  // A. 真实自动迁移 baseline：real-v2-generator-app（generator 默认 defineConfig）
  //    来源：origin/v2 MWA generator 模板。验证 v2→v3 自动迁移主路径。
  // ============================================================
  console.log('== A. real-v2-generator-app (generator 默认 defineConfig) ==');
  const ga = prepare('real-v2-generator-app', false);
  const gaScan = execFileSync(
    'node',
    [path.join(SCRIPTS, 'scan-project.mjs'), ga.work],
    { encoding: 'utf8' },
  );
  check('[provenance] 扫描判定为 v2 项目', /\(v2\)/.test(gaScan));
  check('[provenance] 含 PROVENANCE.md 注明来源', ga.has('PROVENANCE.md'));
  execFileSync(
    'node',
    [path.join(SCRIPTS, 'migrate.mjs'), ga.work, '--to=3.0.0'],
    { encoding: 'utf8' },
  );
  const gaPkg = JSON.parse(ga.read('package.json'));
  check(
    '[auto] @modern-js/app-tools 升到 3.0.0',
    gaPkg.devDependencies['@modern-js/app-tools'] === '3.0.0',
  );
  check(
    '[auto] @modern-js/runtime 升到 3.0.0',
    gaPkg.dependencies['@modern-js/runtime'] === '3.0.0',
  );
  const gaCfgExecution = ga.module('modern.config.ts');
  const gaCfg = gaCfgExecution.defaultExport;
  check(
    '[provenance] 仍为 defineConfig（未被改成 applyBaseConfig）',
    callsNamed(gaCfgExecution, 'defineConfig').length === 1 &&
      callsNamed(gaCfgExecution, 'applyBaseConfig').length === 0,
  );
  check(
    '[auto] appTools({ bundler }) → appTools()',
    gaCfg.plugins[0].name === 'appTools' &&
      gaCfg.plugins[0].options === undefined,
  );
  check(
    '[auto] modern.config 顶层 runtime 块已移除',
    gaCfg.runtime === undefined,
  );
  const gaRt = ga.module('src/modern.runtime.ts').defaultExport;
  check(
    '[auto] runtime 合并进已存在的空 defineRuntimeConfig({})',
    gaRt.router === true,
  );
  check(
    '[routes] 标准约定式路由结构保留 page/layout',
    ga.has('src/routes/page.tsx') && ga.has('src/routes/layout.tsx'),
  );
  check(
    '[routes] 未生成错误 routes/index.tsx、entry.tsx 或 legacy-*',
    !ga.has('src/routes/index.tsx') &&
      !ga.has('src/entry.tsx') &&
      !ga.has('src/legacy-app') &&
      !ga.has('src/legacy-routes'),
  );
  check(
    '[auto] 移除 v3 不支持的 modern new/upgrade scripts',
    !JSON.parse(ga.read('package.json')).scripts.new &&
      !JSON.parse(ga.read('package.json')).scripts.upgrade,
  );
  const gaReport = ga.report();
  check(
    '[auto] report.changed 记录 runtime → modern.runtime.ts',
    gaReport.changed.some(c => /runtime 块/.test(c)),
  );
  check(
    '[auto] manual 为空（默认 app 可全自动迁移）',
    gaReport.manual.length === 0,
  );

  // A2. real-v2-generator-app-js（JS module.exports 静态配置，自动迁移）
  console.log(
    '== A2. real-v2-generator-app-js (JS module.exports 静态配置) ==',
  );
  const gj = prepare('real-v2-generator-app-js');
  check('[provenance] 含 PROVENANCE.md', gj.has('PROVENANCE.md'));
  const gjCfgExecution = gj.module('modern.config.js');
  const gjCfg = gjCfgExecution.defaultExport;
  check(
    '[auto] module.exports: appTools({ bundler }) → appTools()',
    gjCfg.plugins[0].name === 'appTools' &&
      gjCfg.plugins[0].options === undefined,
  );
  check(
    '[auto] module.exports 顶层 runtime 块已移除',
    gjCfg.runtime === undefined,
  );
  check(
    '[auto] runtime 合并进 src/modern.runtime.js',
    gj.has('src/modern.runtime.js') &&
      gj.module('src/modern.runtime.js').defaultExport.router === true,
  );
  check(
    '[auto] 固定 2.x 依赖升 3.0.0',
    JSON.parse(gj.read('package.json')).dependencies['@modern-js/runtime'] ===
      '3.0.0',
  );
  check(
    '[auto] 未误报「函数式/动态配置」manual',
    !/函数式\/动态/.test(gj.report().manual.join('\n')),
  );

  // ============================================================
  // B. origin/v2 integration 真实形态（applyBaseConfig 包装）
  //    验证：结构性迁移（runtime/plugins/appTools）进 manual、不假成功；
  //    文件级安全改写（依赖/import 路径/tailwind）照常。
  // ============================================================

  // B1. real-v2-bff-hono（applyBaseConfig + bffPlugin + runtime.router）
  console.log('== B1. real-v2-bff-hono (applyBaseConfig, manual 语义) ==');
  const bh = prepare('real-v2-bff-hono');
  check('[provenance] 含 PROVENANCE.md', bh.has('PROVENANCE.md'));
  const bhCfgExecution = bh.module('modern.config.ts');
  const bhCfg = bhCfgExecution.defaultExport;
  check(
    '[provenance] applyBaseConfig 包装保留（未被自动展开）',
    callsNamed(bhCfgExecution, 'applyBaseConfig').length === 1,
  );
  check(
    '[provenance] runtime.router 结构保留在 config（未被搬走）',
    bhCfg.runtime.router === true,
  );
  check(
    '[provenance] 未生成 src/modern.runtime.ts',
    !bh.has('src/modern.runtime.ts'),
  );
  const bhManual = bh.report().manual.join('\n');
  check(
    '[manual] 报告明确「结构迁移未完成」+ applyBaseConfig',
    /结构迁移未完成/.test(bhManual) && /applyBaseConfig/.test(bhManual),
  );
  check(
    '[provenance] workspace:* 依赖保留（未强升固定版本）',
    JSON.parse(bh.read('package.json')).dependencies['@modern-js/runtime'] ===
      'workspace:*',
  );
  const bhPackage = JSON.parse(bh.read('package.json'));
  const bhHonoSources = [
    bh.read('api/index.ts'),
    bh.read('server/modern.server.ts'),
  ].join('\n');
  check(
    '[security] Hono 4 依赖在迁移后保留',
    bhPackage.dependencies.hono === '^4.13.5',
  );
  check(
    '[security] BFF fixture 不重新声明旧 Node 支持',
    bhPackage.engines?.node === '>=26.7.0',
  );
  check(
    '[compat] BFF fixture 不依赖 Hono 3 直接或私有 API',
    !/from\s+['"]hono(?:\/[^'"]+)?['"]/.test(bhHonoSources) &&
      /from\s+['"]@modern-js\/plugin-bff\/hono['"]/.test(bhHonoSources) &&
      /from\s+['"]@modern-js\/server-runtime['"]/.test(bhHonoSources),
  );
  check(
    '[manual] workspace 协议依赖进 manual（随 monorepo 升级）',
    /workspace\/link\/catalog 协议依赖/.test(bhManual),
  );
  check(
    '[manual] React18 + ssr.mode:stream 不误报 SSR 人工项',
    !/React17|ssr\.mode 设回/.test(bhManual),
  );

  // B2. real-v2-server-config（applyBaseConfig + server/index.ts hook + modernConfig.runtime）
  console.log(
    '== B2. real-v2-server-config (applyBaseConfig + server hook) ==',
  );
  const sc = prepare('real-v2-server-config');
  check('[provenance] 含 PROVENANCE.md', sc.has('PROVENANCE.md'));
  const scCfgExecution = sc.module('modern.config.ts');
  const scCfg = scCfgExecution.defaultExport;
  check(
    '[provenance] applyBaseConfig 包装保留',
    callsNamed(scCfgExecution, 'applyBaseConfig').length === 1,
  );
  check(
    '[provenance] runtime 结构保留在 config',
    scCfg.runtime.router === false,
  );
  check(
    '[auto] server contract migrates to an executable Modern.js v3 server module',
    sc.module('server/modern.server.ts').defaultExport.middlewares.length === 1,
  );
  const scManual = sc.report().manual.join('\n');
  check(
    '[manual] applyBaseConfig 结构迁移未完成',
    /结构迁移未完成/.test(scManual),
  );
  check(
    '[manual] server/index.ts hook → modern.server.ts 进人工',
    /modern\.server/.test(scManual),
  );
  check(
    '[manual] package.json 的 modernConfig.runtime 进人工',
    /modernConfig\.runtime/.test(scManual),
  );

  // B3. real-v2-tailwindcss-v2（applyBaseConfig + tailwind）
  console.log('== B3. real-v2-tailwindcss-v2 (applyBaseConfig + tailwind) ==');
  const tw = prepare('real-v2-tailwindcss-v2');
  check('[provenance] 含 PROVENANCE.md', tw.has('PROVENANCE.md'));
  check(
    '[provenance] applyBaseConfig 包装保留',
    callsNamed(tw.module('modern.config.ts'), 'applyBaseConfig').length === 1,
  );
  check(
    '[auto] 移除 @modern-js/plugin-tailwindcss 依赖',
    !JSON.parse(tw.read('package.json')).dependencies[
      '@modern-js/plugin-tailwindcss'
    ],
  );
  check('[auto] 生成 postcss.config.cjs', tw.has('postcss.config.cjs'));
  check(
    '[auto] 移除 tailwindcssPlugin() 调用与 import',
    !tw
      .module('modern.config.ts')
      .requires.includes('@modern-js/plugin-tailwindcss'),
  );
  check(
    '[manual] applyBaseConfig plugins 结构迁移未完成',
    /结构迁移未完成/.test(tw.report().manual.join('\n')),
  );

  // ============================================================
  // C. 存量 / blocker edge
  // ============================================================

  // C0. legacy-v2-app-config：存量 2.0 形态（App.config/App.init/server/index）
  console.log('== C0. legacy-v2-app-config (存量 2.0 形态) ==');
  const a = prepare('legacy-v2-app-config');
  const pkg = JSON.parse(a.read('package.json'));
  check(
    '@modern-js/app-tools 升到 3.0.0',
    pkg.devDependencies['@modern-js/app-tools'] === '3.0.0',
  );
  check(
    '移除 @modern-js/plugin-tailwindcss',
    !pkg.devDependencies['@modern-js/plugin-tailwindcss'],
  );
  check('生成 postcss.config.cjs', a.has('postcss.config.cjs'));
  const cfgExecution = a.module('modern.config.ts');
  const cfg = cfgExecution.defaultExport;
  check(
    'config 移除 tailwindcssPlugin() 调用',
    !cfgExecution.requires.includes('@modern-js/plugin-tailwindcss'),
  );
  check(
    'dev.port → server.port（server 含 port: 8080）',
    cfg.server.port === 8080,
  );
  check('config 不再有 dev: { port }', cfg.dev === undefined);
  const app = a.module('src/App.tsx');
  check('App.tsx 不再有 App.config', app.defaultExport.config === undefined);
  check('生成 src/modern.runtime.ts', a.has('src/modern.runtime.ts'));
  const rt = a.has('src/modern.runtime.ts')
    ? a.module('src/modern.runtime.ts').defaultExport
    : '';
  check(
    'modern.runtime.ts 含 defineRuntimeConfig + supportHtml5History',
    rt.router.supportHtml5History === true,
  );
  check(
    'BFF runtime migration produces an executable plugin configuration',
    cfg.plugins.some(value => value.name === 'bffPlugin'),
  );
  const server = a.module('server/modern.server.ts');
  check(
    'server: index.* → modern.server.* 骨架（defineServerConfig，可 build）+ 移除 index.*',
    a.has('server/modern.server.ts') &&
      callsNamed(server, 'defineServerConfig').length === 1 &&
      server.requires.includes('@modern-js/server-runtime') &&
      !a.has('server/index.ts'),
  );
  app.defaultExport();
  check(
    'React18: useRuntimeContext → useContext(RuntimeContext)',
    callsNamed(app, 'useRuntimeContext').length === 0 &&
      callsNamed(app, 'useContext').length === 1 &&
      app.requires.includes('react'),
  );
  check(
    '补充 @modern-js/plugin-bff 依赖',
    pkg.dependencies['@modern-js/plugin-bff'] === '3.0.0',
  );
  check(
    '补充 @modern-js/server-runtime 依赖',
    pkg.dependencies['@modern-js/server-runtime'] === '3.0.0',
  );
  check(
    'config 加入 bffPlugin()（顺序 appTools 在前、无双逗号）',
    sameValue(pluginNames(cfg), ['appTools', 'bffPlugin']),
  );
  const manualA = a.report().manual.join('\n');
  check('人工清单含 App.init', /App\.init/.test(manualA));
  check('人工清单含 自定义 server', /modern\.server/.test(manualA));
  check(
    'appIcon 字符串自动迁移为对象 { icons:[{ src,size }] }（config.mdx）',
    cfg.html.appIcon.icons[0].src === './src/assets/icon.png' &&
      cfg.html.appIcon.icons[0].size === 180,
  );
  check('人工清单含 ssr', /ssr|SSR/.test(manualA));

  // C1. 已有 modern.runtime.ts + 复杂 dev 块：v2-edge-runtime
  console.log('== C1. v2-edge-runtime (existing runtime + dev:{port,hmr}) ==');
  const b = prepare('v2-edge-runtime');
  const bRuntime = b.module('src/modern.runtime.ts');
  check(
    '已有 modern.runtime.ts 未被覆盖（保留 existingPlugin）',
    callsNamed(bRuntime, './existing-plugin.existingPlugin').length === 1,
  );
  const bApp = b.module('src/App.tsx').defaultExport;
  check(
    'App.tsx 保留 App.config（未盲目抽取）',
    bApp.config.router.supportHtml5History === true,
  );
  check(
    'App.config 进人工清单',
    /modern\.runtime\.ts/.test(b.report().manual.join('\n')),
  );
  const cfgB = b.module('modern.config.ts').defaultExport;
  check(
    '复杂 dev 块：port 移走但保留 hmr',
    cfgB.dev.hmr === true && cfgB.dev.port === undefined,
  );
  check('复杂 dev 块：server 含 port: 8080', cfgB.server.port === 8080);

  // C2. pages 引用：v2-edge-pages
  console.log('== C2. v2-edge-pages (pages + import ../pages) ==');
  const c = prepare('v2-edge-pages');
  check('src/pages → src/routes', c.has('src/routes') && !c.has('src/pages'));
  check(
    'pages/index.tsx → routes/page.tsx（v3 标准首页）',
    c.has('src/routes/page.tsx') && !c.has('src/routes/index.tsx'),
  );
  check(
    'pages/about/index.tsx → routes/about/page.tsx',
    c.has('src/routes/about/page.tsx') && !c.has('src/routes/about/index.tsx'),
  );
  const link = c.module('src/components/Link.tsx');
  check(
    '引用 ../pages/index → ../routes/page',
    typeof link.exports.Link() === 'function',
  );
  const aboutLink = c.module('src/components/AboutLink.tsx');
  check(
    '引用 ../pages/about/index → ../routes/about/page',
    typeof aboutLink.exports.AboutLink() === 'function',
  );
  check(
    '无残留 pages 引用人工项',
    !/pages 引用/.test(c.report().manual.join('\n')),
  );

  // C3. 嵌套 dev.client.port（顶层无 port）：不能误迁
  console.log('== C3. v2-edge-devnested (nested dev.client.port only) ==');
  const dn = prepare('v2-edge-devnested');
  const cfgDn = dn.module('modern.config.ts').defaultExport;
  check(
    '嵌套 client.port 8081 保留（不被误迁）',
    cfgDn.dev.client.port === 8081,
  );
  check('顶层无 port → 不创建 server.port', cfgDn.server?.port === undefined);

  // C4. 嵌套 client.port + 顶层 port：只迁顶层
  console.log(
    '== C4. v2-edge-devboth (nested client.port + top-level port) ==',
  );
  const db = prepare('v2-edge-devboth');
  const cfgDb = db.module('modern.config.ts').defaultExport;
  check('顶层 dev.port → server.port (8080)', cfgDb.server.port === 8080);
  check('嵌套 client.port 8081 保留', cfgDb.dev.client.port === 8081);

  // C5. React 19：useRuntimeContext → use()
  console.log('== C5. v2-edge-react19 (React 19 → use()) ==');
  const r = prepare('v2-edge-react19');
  const appR = r.module('src/App.tsx');
  appR.defaultExport();
  check(
    'React19: useRuntimeContext → use(RuntimeContext)',
    callsNamed(appR, 'use').length === 1 &&
      callsNamed(appR, 'useRuntimeContext').length === 0,
  );

  // C6. BFF import 但 config 无 plugins 数组：必须真的插入 bffPlugin()
  console.log(
    '== C6. v2-edge-bff-noplugins (defineConfig({}) + bff import) ==',
  );
  const bn = prepare('v2-edge-bff-noplugins');
  const cfgBn = bn.module('modern.config.ts').defaultExport;
  check(
    '无 plugins 数组时插入 plugins: [appTools(), bffPlugin()]',
    sameValue(pluginNames(cfgBn), ['appTools', 'bffPlugin']),
  );
  check(
    '补 @modern-js/plugin-bff 依赖',
    JSON.parse(bn.read('package.json')).dependencies[
      '@modern-js/plugin-bff'
    ] === '3.0.0',
  );

  // C7. RuntimeContext 返回值结构变化：context.isBrowser 进人工清单
  console.log('== C7. v2-edge-runtimectx (context.isBrowser) ==');
  const rc = prepare('v2-edge-runtimectx');
  check(
    'context.isBrowser 旧用法进人工清单',
    /isBrowser/.test(rc.report().manual.join('\n')),
  );

  // C8. 已有 bffPlugin import（双引号）：不能重复 import
  console.log(
    '== C8. v2-edge-bff-dq (existing double-quote bffPlugin import) ==',
  );
  const bd = prepare('v2-edge-bff-dq');
  const cfgBdExecution = bd.module('modern.config.ts');
  const cfgBd = cfgBdExecution.defaultExport;
  check(
    '不重复 import @modern-js/plugin-bff（只 1 处）',
    cfgBdExecution.requires.filter(value => value === '@modern-js/plugin-bff')
      .length === 1,
  );
  check(
    '复用已有 import 加入 bffPlugin()',
    pluginNames(cfgBd).includes('bffPlugin'),
  );

  // C9. 已有 react import + useRuntimeContext：不能重复声明
  console.log('== C9. v2-edge-react-existing (existing react import) ==');
  const re = prepare('v2-edge-react-existing');
  const appRe = re.module('src/App.tsx');
  appRe.defaultExport();
  check(
    'react import 只 1 处（不重复声明）',
    appRe.requires.filter(value => value === 'react').length === 1,
  );
  check(
    'RuntimeContext 迁移结果可执行且只读取一次 context',
    callsNamed(appRe, 'useContext').length === 1,
  );
  check(
    'useRuntimeContext → useContext(RuntimeContext)',
    callsNamed(appRe, 'useRuntimeContext').length === 0 &&
      callsNamed(appRe, 'useContext').length === 1,
  );

  // C10. 嵌套 plugins（postcss）+ 无顶层 plugins：BFF 必须进顶层
  console.log('== C10. v2-edge-bff-nested-plugins (nested postcss plugins) ==');
  const np = prepare('v2-edge-bff-nested-plugins');
  const cfgNp = np.module('modern.config.ts').defaultExport;
  check(
    '顶层注入 plugins: [appTools(), bffPlugin()]',
    sameValue(pluginNames(cfgNp), ['appTools', 'bffPlugin']),
  );
  check(
    '未把 bffPlugin() 误塞进 postcss 嵌套 plugins',
    sameValue(cfgNp.tools.postcss.postcssOptions.plugins, []),
  );

  // C11. blocker：React default import 必须保留（import React, { ... }）
  console.log(
    '== C11. v2-edge-react-default-import (preserve default React) ==',
  );
  const rd = prepare('v2-edge-react-default-import');
  const appRd = rd.module('src/App.tsx');
  const appRdOutput = appRd.defaultExport();
  check(
    'default React import remains executable for React.Fragment',
    typeof appRdOutput.type === 'symbol',
  );
  check(
    'useContext 合并进同一 react import',
    appRd.requires.filter(value => value === 'react').length === 1 &&
      callsNamed(appRd, 'useContext').length === 1,
  );
  check(
    'useRuntimeContext → useContext(RuntimeContext)',
    callsNamed(appRd, 'useRuntimeContext').length === 0 &&
      callsNamed(appRd, 'useContext').length === 1,
  );

  // C12. blocker：useRuntimeContext as alias 不假迁移，进人工清单
  console.log('== C12. v2-edge-runtimectx-alias (alias → manual) ==');
  const al = prepare('v2-edge-runtimectx-alias');
  const appAl = al.module('src/App.tsx');
  appAl.defaultExport();
  check(
    'alias useCtx() 未被错误改写',
    callsNamed(appAl, 'useRuntimeContext').length === 1 &&
      callsNamed(appAl, 'useContext').length === 0,
  );
  check('alias 进人工清单', /别名|alias/.test(al.report().manual.join('\n')));

  // C13. blocker：BFF 无 appTools import → 自动补 import
  console.log('== C13. v2-edge-bff-add-apptools (auto-add appTools import) ==');
  const aa = prepare('v2-edge-bff-add-apptools');
  const cfgAaExecution = aa.module('modern.config.ts');
  const cfgAa = cfgAaExecution.defaultExport;
  check(
    'appTools 补进 @modern-js/app-tools import',
    callsNamed(cfgAaExecution, 'appTools').length === 1,
  );
  check(
    'plugins: [appTools(), bffPlugin()]',
    sameValue(pluginNames(cfgAa), ['appTools', 'bffPlugin']),
  );

  // C14. blocker：BFF 完全无 appTools import → manual，不写半成品
  console.log(
    '== C14. v2-edge-bff-no-apptools (no app-tools import → manual) ==',
  );
  const na = prepare('v2-edge-bff-no-apptools');
  check(
    '未写半成品 plugins（无 bffPlugin() 落盘）',
    callsNamed(na.module('modern.config.ts'), 'bffPlugin').length === 0,
  );
  check(
    '进人工清单（提示手动加 appTools/bffPlugin）',
    /appTools/.test(na.report().manual.join('\n')),
  );

  // C15. runtime merge 冲突：已有非空 modern.runtime.ts 不能被覆盖，runtime 留在 config + manual
  console.log(
    '== C15. v2-edge-runtime-conflict (non-empty runtime.ts → no overwrite) ==',
  );
  const rcf = prepare('v2-edge-runtime-conflict');
  const rcfRt = rcf.module('src/modern.runtime.ts');
  check(
    '已有非空 modern.runtime.ts 未被覆盖（保留 existingPlugin）',
    callsNamed(rcfRt, './plugins.existingPlugin').length === 1,
  );
  const rcfCfg = rcf.module('modern.config.ts').defaultExport;
  check(
    '冲突时 runtime 仍从 config 移除（v3 不接受顶层 runtime，否则 build TS2353 失败）',
    rcfCfg.runtime === undefined,
  );
  check(
    '冲突时 runtime 保持有效且待人工合并明确进入报告',
    rcfRt.defaultExport.plugins.length === 1 &&
      /人工合并/.test(rcf.report().manual.join('\n')),
  );
  check(
    'appTools({ bundler }) 仍被去掉（安全改写照常）',
    rcfCfg.plugins[0].name === 'appTools' &&
      rcfCfg.plugins[0].options === undefined,
  );
  check(
    '冲突进人工清单（需人工合并）',
    /人工合并/.test(rcf.report().manual.join('\n')),
  );

  // C16. blocker：BFF 插入已有 plugins 时顺序 = [appTools(), bffPlugin()]（append，不前插）
  console.log('== C16. v2-edge-bff-existing-plugins (append order) ==');
  const ep = prepare('v2-edge-bff-existing-plugins');
  const cfgEp = ep.module('modern.config.ts').defaultExport;
  check(
    'plugins: [appTools(), bffPlugin()]（bffPlugin 追加到末尾，不在 appTools 之前）',
    sameValue(pluginNames(cfgEp), ['appTools', 'bffPlugin']),
  );
  check(
    '无前插（不是 [bffPlugin(), appTools()]）',
    cfgEp.plugins[0].name === 'appTools',
  );

  // C17. JS/静态：defineConfig<'rspack'>({}) 泛型写法走主路径，不误报动态
  console.log(
    '== C17. v2-edge-defineconfig-generic (defineConfig<...>({})) ==',
  );
  const dg = prepare('v2-edge-defineconfig-generic');
  const cfgDg = dg.module('modern.config.ts').defaultExport;
  check(
    '泛型 defineConfig：appTools({ bundler }) → appTools()',
    cfgDg.plugins[0].name === 'appTools' &&
      cfgDg.plugins[0].options === undefined,
  );
  check('泛型 defineConfig：runtime 块已移除', cfgDg.runtime === undefined);
  check(
    '泛型 defineConfig：runtime 合并进新建 src/modern.runtime.ts',
    dg.has('src/modern.runtime.ts') &&
      dg.module('src/modern.runtime.ts').defaultExport.router === true,
  );
  check(
    '泛型 defineConfig：未误报「函数式/动态」',
    !/函数式\/动态/.test(dg.report().manual.join('\n')),
  );

  // ============================================================
  // D. 负向：v3-workspace-app —— workspace 协议 + 无 v2 信号 → 阻断，不误迁
  // ============================================================
  console.log('== D. v3-workspace-app (workspace + 无 v2 信号 → 阻断) ==');
  const dWork = path.join(os.tmpdir(), 'mj-neg-');
  const negDir = fs.mkdtempSync(dWork);
  tmpDirs.push(negDir);
  copyDir(path.join(HERE, 'fixtures', 'v3-workspace-app'), negDir);
  // scan 必须非 0 阻断
  let scanBlocked = false;
  try {
    execFileSync('node', [path.join(SCRIPTS, 'scan-project.mjs'), negDir], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch {
    scanBlocked = true;
  }
  check('[blocking] scan-project 非 0 退出（ambiguous 阻断）', scanBlocked);
  check(
    '[blocking] scan 未写 context.json',
    !fs.existsSync(
      path.join(negDir, '.agents/runs/modernjs-migrate/context.json'),
    ),
  );
  // migrate 二次保护：非 0 退出且不改文件
  const cfgBefore = executeModule(negDir, 'modern.config.ts').defaultExport;
  const pkgBefore = JSON.parse(
    fs.readFileSync(path.join(negDir, 'package.json'), 'utf8'),
  );
  let migrateBlocked = false;
  try {
    execFileSync(
      'node',
      [path.join(SCRIPTS, 'migrate.mjs'), negDir, '--to=3.0.0'],
      {
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
  } catch {
    migrateBlocked = true;
  }
  check('[blocking] migrate 非 0 退出（二次保护）', migrateBlocked);
  check(
    '[blocking] migrate 未改写 modern.config.ts',
    sameValue(
      executeModule(negDir, 'modern.config.ts').defaultExport,
      cfgBefore,
    ),
  );
  const pkgAfter = JSON.parse(
    fs.readFileSync(path.join(negDir, 'package.json'), 'utf8'),
  );
  check(
    '[blocking] migrate 保留 workspace:* 未升固定版本',
    sameValue(pkgAfter, pkgBefore) &&
      pkgAfter.dependencies['@modern-js/runtime'] === 'workspace:*',
  );
  check(
    '[blocking] migrate 未产生 report.json',
    !fs.existsSync(
      path.join(negDir, '.agents/runs/modernjs-migrate/report.json'),
    ),
  );

  // C18. blocker：注释里的 defineConfig 不参与定位/信号，真实配置正确迁移、注释不被改坏
  console.log(
    '== C18. v2-edge-config-comment (comment defineConfig not parsed) ==',
  );
  const cc = prepare('v2-edge-config-comment');
  const ccRt = cc.has('src/modern.runtime.ts')
    ? cc.module('src/modern.runtime.ts').defaultExport
    : '';
  check(
    'runtime.ts 取真实 config 的 router:true（非注释里的 false）',
    ccRt.router === true,
  );
  const ccCfg = cc.module('modern.config.ts').defaultExport;
  check('真实 config runtime 块已移除', ccCfg.runtime === undefined);
  check(
    '注释示例不影响可执行配置',
    ccCfg.plugins[0].name === 'appTools' &&
      ccCfg.plugins[0].options === undefined,
  );
  check(
    '不被注释里的 webpack 触发误报 manual',
    !/webpack 自定义配置/.test(cc.report().manual.join('\n')),
  );

  // C19. blocker：workspace 项目补 plugin-bff 沿用 workspace 协议（不写固定 3.0.0）
  console.log(
    '== C19. v2-edge-workspace-bff-mapdep (mapped dep keeps protocol) ==',
  );
  const wb = prepare('v2-edge-workspace-bff-mapdep');
  const wbDeps = JSON.parse(wb.read('package.json')).dependencies;
  check(
    '新增 @modern-js/plugin-bff 沿用 workspace:*（非 3.0.0）',
    wbDeps['@modern-js/plugin-bff'] === 'workspace:*',
  );
  check(
    '既有 @modern-js/runtime 仍 workspace:*',
    wbDeps['@modern-js/runtime'] === 'workspace:*',
  );
  check(
    '未引入任何固定 3.0.0',
    Object.values(wbDeps).every(version => version !== '3.0.0'),
  );

  // C20. blocker：workspace 项目补 server-runtime 沿用 workspace 协议
  console.log(
    '== C20. v2-edge-workspace-server-mapdep (mapped dep keeps protocol) ==',
  );
  const ws = prepare('v2-edge-workspace-server-mapdep');
  const wsDeps = JSON.parse(ws.read('package.json')).dependencies;
  check(
    '新增 @modern-js/server-runtime 沿用 workspace:*（非 3.0.0）',
    wsDeps['@modern-js/server-runtime'] === 'workspace:*',
  );
  check(
    '未引入任何固定 3.0.0',
    Object.values(wsDeps).every(version => version !== '3.0.0'),
  );

  // C21. blocker：link:/file:/npm: 协议不能照搬给映射依赖（会指错路径）→ manual
  console.log('== C21. v2-edge-link-bff-mapdep (link: protocol → manual) ==');
  const lk = prepare('v2-edge-link-bff-mapdep');
  const lkDeps = JSON.parse(lk.read('package.json')).dependencies;
  check(
    '未自动新增 @modern-js/plugin-bff（link: 无法照搬）',
    lkDeps['@modern-js/plugin-bff'] == null,
  );
  check(
    '未把 app-tools 的 link 路径写给别的包',
    lkDeps['@modern-js/plugin-bff'] === undefined,
  );
  check(
    '既有 link: 依赖原样保留',
    lkDeps['@modern-js/runtime'] === 'link:../../packages/runtime' &&
      lkDeps['@modern-js/app-tools'] === undefined &&
      JSON.parse(lk.read('package.json')).devDependencies[
        '@modern-js/app-tools'
      ] === 'link:../../packages/app-tools',
  );
  check(
    'link: 协议补依赖进 manual（提示手动添加）',
    /link:.*请手动添加.*plugin-bff/s.test(lk.report().manual.join('\n')),
  );

  // ============================================================
  // D2. 负向：v3 workspace app + 字符串里写 legacy 配置示例 → 仍 ambiguous 阻断
  // ============================================================
  console.log('== D2. v3-workspace-app-string-literal (string ≠ v2 signal) ==');
  const negStr = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-negstr-'));
  tmpDirs.push(negStr);
  copyDir(
    path.join(HERE, 'fixtures', 'v3-workspace-app-string-literal'),
    negStr,
  );
  let scanBlocked2 = false;
  try {
    execFileSync('node', [path.join(SCRIPTS, 'scan-project.mjs'), negStr], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch {
    scanBlocked2 = true;
  }
  check(
    '[blocking] 字符串里的 legacy 配置不触发 v2 信号 → scan 仍阻断',
    scanBlocked2,
  );
  const negCfgBefore = executeModule(negStr, 'modern.config.ts').defaultExport;
  let migrateBlocked2 = false;
  try {
    execFileSync(
      'node',
      [path.join(SCRIPTS, 'migrate.mjs'), negStr, '--to=3.0.0'],
      {
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
  } catch {
    migrateBlocked2 = true;
  }
  check('[blocking] migrate 仍阻断（二次保护）', migrateBlocked2);
  check(
    '[blocking] migrate 未改写 modern.config.ts',
    sameValue(
      executeModule(negStr, 'modern.config.ts').defaultExport,
      negCfgBefore,
    ),
  );
  check(
    '[blocking] 未产生 report.json',
    !fs.existsSync(
      path.join(negStr, '.agents/runs/modernjs-migrate/report.json'),
    ),
  );

  // C22. blocker：已确认 v2 项目里，注释/普通字符串提到 runtime/bff|server 不被改写、不补依赖/插件
  console.log(
    '== C22. v2-edge-import-in-text (bff in comment/string ≠ import) ==',
  );
  const it = prepare('v2-edge-import-in-text');
  const itNotes = it.module('src/notes.ts');
  check(
    'notes.ts 普通字符串仍是可执行数据而非模块引用',
    itNotes.exports.noop() === itNotes.exports.doc &&
      itNotes.requires.length === 0,
  );
  const itPkg = JSON.parse(it.read('package.json'));
  check(
    '未误补 plugin-bff / server-runtime 依赖',
    !{ ...itPkg.dependencies, ...itPkg.devDependencies }[
      '@modern-js/plugin-bff'
    ] &&
      !{ ...itPkg.dependencies, ...itPkg.devDependencies }[
        '@modern-js/server-runtime'
      ],
  );
  check(
    '未误加 bffPlugin()',
    callsNamed(it.module('modern.config.ts'), 'bffPlugin').length === 0,
  );

  // C23. blocker：注释里的 dev: { port } 不参与定位，不破坏真实 config；真实 dev.port 仍正常迁移
  console.log('== C23. v2-edge-dev-in-comment (comment dev ≠ real dev) ==');
  const dc2 = prepare('v2-edge-dev-in-comment');
  const dc2Cfg = dc2.module('modern.config.ts').defaultExport;
  check(
    '真实 defineConfig 未被破坏（仍含 export default defineConfig + appTools()）',
    sameValue(pluginNames(dc2Cfg), ['appTools']),
  );
  check('真实 dev.port → server.port (8080)', dc2Cfg.server.port === 8080);
  check('注释里的 dev 配置不影响运行时结果', dc2Cfg.dev === undefined);
  check(
    'runtime 仍正常合并进 modern.runtime.ts',
    dc2.has('src/modern.runtime.ts') &&
      dc2.module('src/modern.runtime.ts').defaultExport.router === true,
  );

  // C24. blocker：带 magic comment 的真实 dynamic import / require 也要迁移（scanner 检测/改写一致）
  console.log(
    '== C24. v2-edge-dynamic-import-comment (magic-comment import/require) ==',
  );
  const di = prepare('v2-edge-dynamic-import-comment');
  const diLazy = di.module('src/lazy.ts');
  await diLazy.exports.loadBff();
  await diLazy.exports.loadServer();
  check(
    'dynamic import(/* magic */ ...) 改写为 plugin-bff/client',
    diLazy.requires.includes('@modern-js/plugin-bff/client') &&
      !diLazy.requires.includes('@modern-js/runtime/bff'),
  );
  check(
    'require(/* comment */ ...) 改写为 server-runtime',
    diLazy.requires.includes('@modern-js/server-runtime') &&
      !diLazy.requires.includes('@modern-js/runtime/server'),
  );
  const diDeps = JSON.parse(di.read('package.json')).dependencies;
  check(
    '补 plugin-bff + server-runtime 依赖',
    diDeps['@modern-js/plugin-bff'] === '3.0.0' &&
      diDeps['@modern-js/server-runtime'] === '3.0.0',
  );
  check(
    'config 加入 bffPlugin()',
    pluginNames(di.module('modern.config.ts').defaultExport).includes(
      'bffPlugin',
    ),
  );

  // C25. blocker：嵌套 tools.dev.port 不被误迁成顶层 server.port
  console.log('== C25. v2-edge-tools-dev-nested (nested tools.dev.port) ==');
  const td = prepare('v2-edge-tools-dev-nested');
  const tdCfg = td.module('modern.config.ts').defaultExport;
  check(
    '嵌套 tools.dev.port 原样保留（7777 未被搬走）',
    tdCfg.tools.dev.port === 7777,
  );
  check('未创建顶层 server.port', tdCfg.server?.port === undefined);
  check(
    'report 未把 dev.port 标为自动迁移',
    !td.report().changed.some(c => /dev\.port/.test(c)),
  );

  // C26. blocker：tailwind 移除只删真实 import 行，不删普通字符串行；plugins 无悬挂逗号
  console.log(
    '== C26. v2-edge-tailwind-string-line (string line not deleted) ==',
  );
  const tl = prepare('v2-edge-tailwind-string-line');
  const tlCfgExecution = tl.module('modern.config.ts');
  const tlCfg = tlCfgExecution.defaultExport;
  check(
    '普通字符串行（含 plugin-tailwindcss 文本）保留',
    tlCfgExecution.exports.note ===
      "example text: from '@modern-js/plugin-tailwindcss'",
  );
  check(
    '字符串里的 , ] / , ) 不被悬挂逗号清理误改',
    tlCfgExecution.exports.note2 ===
      'keep comma, ] and comma, ) in this string',
  );
  check(
    '真实 tailwind import 行已删除',
    !tlCfgExecution.requires.includes('@modern-js/plugin-tailwindcss'),
  );
  check(
    'tailwindcssPlugin() 调用移除且无悬挂逗号',
    sameValue(pluginNames(tlCfg), ['appTools']),
  );
  check('生成 postcss.config.cjs', tl.has('postcss.config.cjs'));
  check(
    '移除 @modern-js/plugin-tailwindcss 依赖',
    !JSON.parse(tl.read('package.json')).devDependencies[
      '@modern-js/plugin-tailwindcss'
    ],
  );

  // C27. blocker：多行 tailwind import 删除完整声明，不留半截语法
  console.log(
    '== C27. v2-edge-tailwind-multiline-import (full decl removal) ==',
  );
  const ml = prepare('v2-edge-tailwind-multiline-import');
  const mlCfgExecution = ml.module('modern.config.ts');
  const mlCfg = mlCfgExecution.defaultExport;
  check(
    '多行 import 完整删除（无 plugin-tailwindcss 残留）',
    !mlCfgExecution.requires.includes('@modern-js/plugin-tailwindcss'),
  );
  check(
    '不留半截 import 片段（无悬空 tailwindcssPlugin 标识符）',
    callsNamed(mlCfgExecution, 'tailwindcssPlugin').length === 0,
  );
  check(
    'appTools import / defineConfig 完好',
    callsNamed(mlCfgExecution, 'defineConfig').length === 1 &&
      callsNamed(mlCfgExecution, 'appTools').length === 1,
  );
  check(
    'plugins 数组干净（[appTools()]）',
    sameValue(pluginNames(mlCfg), ['appTools']),
  );

  // C28. blocker：dynamic import 的 tailwind 不被当 static 声明删坏 → 保留 + manual + 依赖不删
  console.log(
    '== C28. v2-edge-tailwind-dynamic-import (dynamic ≠ static decl) ==',
  );
  const dyi = prepare('v2-edge-tailwind-dynamic-import');
  const dyiCfg = dyi.module('modern.config.ts');
  check(
    'dynamic import 所在配置仍可由 TypeScript 编译并执行',
    sameValue(pluginNames(dyiCfg.defaultExport), ['appTools']),
  );
  check(
    'plugin-tailwindcss 依赖保留（未删、未升到不存在的 3.0.0）',
    JSON.parse(dyi.read('package.json')).devDependencies[
      '@modern-js/plugin-tailwindcss'
    ] === '2.66.0',
  );
  check(
    'dynamic/require tailwind 引用进 manual',
    /dynamic import \/ require 引用 @modern-js\/plugin-tailwindcss/.test(
      dyi.report().manual.join('\n'),
    ),
  );

  // C29. blocker：require 的 tailwind 不残留成断链（依赖保留 + manual）
  console.log('== C29. v2-edge-tailwind-require (CJS require) ==');
  const rq = prepare('v2-edge-tailwind-require');
  const rqCfg = rq.module('modern.config.ts');
  check(
    'require 语句原样保留（不被删成断链）',
    rqCfg.requires.includes('@modern-js/plugin-tailwindcss'),
  );
  check(
    'plugin-tailwindcss 依赖保留（与 require 一致，config 仍可加载）',
    JSON.parse(rq.read('package.json')).devDependencies[
      '@modern-js/plugin-tailwindcss'
    ] === '2.66.0',
  );
  check(
    'require 用法进 manual',
    /dynamic import \/ require/.test(rq.report().manual.join('\n')),
  );

  // C30. blocker：routes/index.tsx 不是 v3 约定式路由页面，迁移前直接阻断且不落半成品
  console.log('== C30. v2-edge-routes-index (invalid routes/index.tsx) ==');
  const ri = prepare('v2-edge-routes-index', false);
  const riPkgBefore = JSON.parse(ri.read('package.json'));
  let routesIndexBlocked = false;
  try {
    execFileSync(
      'node',
      [path.join(SCRIPTS, 'migrate.mjs'), ri.work, '--to=3.0.0'],
      {
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
  } catch {
    routesIndexBlocked = true;
  }
  check('[blocking] routes/index.tsx 预检阻断', routesIndexBlocked);
  check(
    '[blocking] routes/index.tsx 阻断时未改 package.json',
    sameValue(JSON.parse(ri.read('package.json')), riPkgBefore),
  );
  check(
    '[blocking] routes/index.tsx 阻断时未产生 report.json',
    !ri.has('.agents/runs/modernjs-migrate/report.json'),
  );

  // C31. blocker：pages 映射冲突（foo.tsx + foo/index.tsx 都→ foo/page.tsx）必须写盘前预检失败，
  //      失败时事务性零改动——src/pages 保留、src/routes 不创建、package.json 未升级/删 scripts、无 report。
  console.log('== C31. v2-edge-pages-conflict (atomic conflict pre-check) ==');
  const pc = prepare('v2-edge-pages-conflict', false);
  const pcPkgBefore = JSON.parse(pc.read('package.json'));
  let pagesConflictBlocked = false;
  try {
    execFileSync(
      'node',
      [path.join(SCRIPTS, 'migrate.mjs'), pc.work, '--to=3.0.0'],
      { encoding: 'utf8', stdio: 'pipe' },
    );
  } catch {
    pagesConflictBlocked = true;
  }
  check('[blocking] pages 冲突写盘前阻断（exit 1）', pagesConflictBlocked);
  check(
    '[blocking] 冲突时 src/pages 保留、src/routes 未创建',
    pc.has('src/pages/foo.tsx') &&
      pc.has('src/pages/foo/index.tsx') &&
      !pc.has('src/routes'),
  );
  check(
    '[blocking] 冲突时 package.json 未改（依赖未升、scripts 未删）',
    sameValue(JSON.parse(pc.read('package.json')), pcPkgBefore),
  );
  check(
    '[blocking] 冲突时未产生 report.json',
    !pc.has('.agents/runs/modernjs-migrate/report.json'),
  );

  // C32. 真实复杂形态（对齐 test_v2 真实迁移前 757d186）：用户自有 legacy-* 目录 + pages 约定式首页
  //      + 自定义入口 index.* + 仅含 port 的顶层 dev 块。回归两个真实 bug：
  //      ① legacy-* 预存在不应被误判为「迁移生成」而中止；② dev 块整块移除不能留悬挂逗号（否则 config 解析失败）。
  console.log(
    '== C32. v2-edge-legacy-pages-dev (real-shape, no false abort / no broken config) ==',
  );
  const lp = prepare('v2-edge-legacy-pages-dev');
  let lpThrew = false;
  try {
    execFileSync(
      'node',
      [path.join(SCRIPTS, 'migrate.mjs'), lp.work, '--to=3.0.0'],
      { encoding: 'utf8', stdio: 'pipe' },
    );
  } catch {
    lpThrew = true;
  }
  check(
    '[no-false-abort] 预存在 legacy-* 不触发中止（迁移正常完成）',
    !lpThrew,
  );
  check(
    '[routes] pages/index.* → routes/page.*（非 routes/index.*）',
    lp.has('src/routes/page.tsx') && !lp.has('src/routes/index.tsx'),
  );
  check(
    '[entry] 自定义入口 index.tsx → entry.tsx',
    lp.has('src/entry.tsx') && !lp.has('src/index.tsx'),
  );
  check(
    '[preserve] 用户自有 legacy-app / legacy-routes 原样保留',
    lp.has('src/legacy-app/App.tsx') && lp.has('src/legacy-routes/layout.tsx'),
  );
  const lpCfg = lp.module('modern.config.ts').defaultExport;
  check(
    '[config] dev 块整块移除后配置仍可由 TypeScript 编译并执行',
    lpCfg != null && typeof lpCfg === 'object',
  );
  check(
    '[config] dev.port 迁到 server.port、顶层 dev 块已移除',
    lpCfg.dev === undefined && lpCfg.server.port === 3000,
  );

  // C33. 综合真实形态（对齐 test_v2 真实迁移前 757d186）：自定义入口 function-decl bootstrap +
  //      pages 约定式 + 用户自有 legacy-* + @modern-js/plugin-server + 复杂 output/source/tools/html v2 配置。
  //      A 目标：迁移后依赖可安装（无不存在版本）、config 可解析、结构符合 v3、report 诚实区分自动/人工。
  console.log('== C33. v2-real-comprehensive (757d186-like full surface) ==');
  const cmp = prepare('v2-real-comprehensive');
  const cmpPkg = JSON.parse(cmp.read('package.json'));
  const cmpDeps = { ...cmpPkg.dependencies, ...cmpPkg.devDependencies };
  check(
    '[install] @modern-js/plugin-server 依赖已移除（不生成不存在的 3.x）',
    !cmpDeps['@modern-js/plugin-server'],
  );
  check(
    '[install] @modern-js/* 升到 3.0.0、清理 modern new/upgrade scripts',
    cmpDeps['@modern-js/runtime'] === '3.0.0' &&
      !cmpPkg.scripts.new &&
      !cmpPkg.scripts.upgrade,
  );
  const cmpCfgExecution = cmp.module('modern.config.ts');
  const cmpCfg = cmpCfgExecution.defaultExport;
  check(
    '[config] serverPlugin() 调用 + @modern-js/plugin-server import 已移除',
    !cmpCfgExecution.requires.includes('@modern-js/plugin-server') &&
      callsNamed(cmpCfgExecution, 'serverPlugin').length === 0,
  );
  check(
    '[config] output v2 字段改名：cssModules.localIdentName + sourceMap:false（取反）+ 无旧字段',
    cmpCfg.output.cssModules.localIdentName ===
      '[name]__[local]-[hash:base64:5]' &&
      cmpCfg.output.sourceMap === false &&
      cmpCfg.output.cssModuleLocalIdentName === undefined &&
      cmpCfg.output.disableSourceMap === undefined &&
      cmpCfg.output.disableMinimize === undefined &&
      cmpCfg.output.enableInlineStyles === undefined,
  );
  check(
    '[config] html.appIcon 字符串→对象、disableHtmlFolder→outputStructure',
    Array.isArray(cmpCfg.html.appIcon.icons) &&
      cmpCfg.html.outputStructure === 'flat' &&
      cmpCfg.html.disableHtmlFolder === undefined,
  );
  const rspackConfig = { name: 'rspack-config' };
  const chainCalls = [];
  cmpCfg.tools.bundlerChain({ name: value => chainCalls.push(value) });
  check(
    '[config] tools.webpack→rspack、webpackChain→bundlerChain',
    cmpCfg.tools.rspack(rspackConfig) === rspackConfig &&
      sameValue(chainCalls, ['app']) &&
      cmpCfg.tools.webpack === undefined &&
      cmpCfg.tools.webpackChain === undefined,
  );
  const cmpRuntime = cmp.module('src/modern.runtime.ts');
  check(
    '[config] 顶层 runtime 从 config 移除（v3 TS2353）+ 非空 modern.runtime.ts 时注释待人工合并',
    cmpCfg.runtime === undefined &&
      cmpRuntime.defaultExport.router.supportHtml5History === true &&
      /人工合并/.test(cmp.report().manual.join('\n')),
  );
  check(
    '[config] source 废弃字段移除、dev 块移除、无悬挂逗号',
    cmpCfg.source === undefined && cmpCfg.dev === undefined,
  );
  const cmpEntry = cmp.module('src/entry.tsx');
  await Promise.resolve();
  check(
    '[entry] function-declaration bootstrap → entry.tsx + createRoot/render',
    cmp.has('src/entry.tsx') &&
      !cmp.has('src/index.tsx') &&
      callsNamed(cmpEntry, 'createRoot').length === 1 &&
      callsNamed(cmpEntry, 'render').length === 1,
  );
  check(
    '[routes] pages/index→routes/page + 自动生成根 routes/layout.tsx',
    cmp.has('src/routes/page.tsx') &&
      cmp.has('src/routes/layout.tsx') &&
      !cmp.has('src/routes/index.tsx'),
  );
  const cmpServer = cmp.module('server/modern.server.ts');
  check(
    '[server] server/index.ts → modern.server.ts 骨架（defineServerConfig）',
    cmp.has('server/modern.server.ts') &&
      !cmp.has('server/index.ts') &&
      callsNamed(cmpServer, 'defineServerConfig').length === 1,
  );
  check(
    '[preserve] 用户自有 legacy-app / legacy-routes 原样保留',
    cmp.has('src/legacy-app/App.tsx') &&
      cmp.has('src/legacy-routes/layout.tsx'),
  );
  const cmpManual = cmp.report().manual.join('\n');
  check(
    '[honest-manual] report 点名 custom server 语义 + resolveMainFields + devServer 待人工',
    /modern\.server/.test(cmpManual) &&
      /resolveMainFields/.test(cmpManual) &&
      /devServer/.test(cmpManual),
  );

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
  console.log('✅ migrate-to-v3 skill 迁移验证通过');
} finally {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
}
