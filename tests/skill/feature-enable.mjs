#!/usr/bin/env node
// 验证 modernjs-feature-enable skill：把 v3-app-no-bff fixture 复制到临时目录，跑
// scan.mjs + enable.mjs bff，断言从「未启用 BFF」迁到「可安装/可构建的 BFF 已启用」形态。
//   node tests/skill/feature-enable.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SCRIPTS = path.join(REPO, 'skills/modernjs-feature-enable/scripts');
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

function prepare(fixture) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-feat-'));
  tmpDirs.push(work);
  copyDir(path.join(HERE, 'fixtures', fixture), work);
  return {
    work,
    read: rel => fs.readFileSync(path.join(work, rel), 'utf8'),
    has: rel => fs.existsSync(path.join(work, rel)),
    report: () =>
      JSON.parse(
        fs.readFileSync(
          path.join(work, '.agents/runs/modernjs-feature-enable/report.json'),
          'utf8',
        ),
      ),
  };
}

function createPlugin(kind) {
  return (...args) => ({ args, kind });
}

const frameworkModules = {
  '@modern-js/app-tools': {
    appTools: createPlugin('app-tools'),
    defineConfig: config => config,
  },
  '@modern-js/plugin-bff': {
    bffPlugin: createPlugin('bff'),
    other: createPlugin('other'),
  },
  '@modern-js/plugin-ssg': {
    ssgPlugin: createPlugin('ssg'),
  },
  '@modern-js/plugin-styled-components': {
    styledComponentsPlugin: createPlugin('styled-components'),
  },
  '@modern-js/runtime/head': {
    Helmet: ({ children }) => children,
  },
  '@modern-js/runtime/router': {
    Outlet: () => null,
  },
  '@modern-js/server-runtime': {
    defineServerConfig: config => config,
  },
};

function compileModule(fixture, relativePath) {
  const filename = path.join(fixture.work, relativePath);
  if (path.extname(filename) === '.js') {
    return fs.readFileSync(filename, 'utf8');
  }

  const outputDirectory = path.join(fixture.work, '.feature-enable-compiled');
  execFileSync(
    path.join(REPO, 'node_modules/.bin/tsgo'),
    [
      filename,
      '--ignoreConfig',
      '--noCheck',
      '--target',
      'es2022',
      '--module',
      'commonjs',
      '--jsx',
      'react-jsx',
      '--rootDir',
      fixture.work,
      '--outDir',
      outputDirectory,
    ],
    { encoding: 'utf8', stdio: 'pipe' },
  );
  return fs.readFileSync(
    path.join(outputDirectory, relativePath.replace(/\.(?:ts|tsx)$/, '.js')),
    'utf8',
  );
}

function executeModule(
  fixture,
  relativePath,
  { moduleOverrides = {}, runtime = {} } = {},
) {
  const filename = path.join(fixture.work, relativePath);
  const moduleRecord = { exports: {} };
  const stateChanges = runtime.stateChanges ?? [];
  const loadedStylesheets = runtime.loadedStylesheets ?? [];
  const reactModule = {
    useEffect: effect => effect(),
    useState: initial => [
      initial,
      value => {
        stateChanges.push(value);
      },
    ],
  };
  const jsxRuntime = {
    Fragment: Symbol.for('react.fragment'),
    jsx: (type, props, key) => ({ key, props, type }),
    jsxs: (type, props, key) => ({ key, props, type }),
  };

  const requireModule = specifier => {
    if (Object.hasOwn(moduleOverrides, specifier)) {
      return moduleOverrides[specifier];
    }
    if (specifier === 'react') return reactModule;
    if (specifier === 'react/jsx-runtime') return jsxRuntime;
    if (Object.hasOwn(frameworkModules, specifier)) {
      return frameworkModules[specifier];
    }
    if (specifier.endsWith('.css')) {
      const stylesheet = path.resolve(path.dirname(filename), specifier);
      if (!fs.existsSync(stylesheet)) {
        throw new Error(
          `Missing stylesheet imported by ${relativePath}: ${specifier}`,
        );
      }
      loadedStylesheets.push(stylesheet);
      return {};
    }
    throw new Error(
      `No behavioral module stub for ${specifier} in ${relativePath}`,
    );
  };

  const wrapper = new vm.Script(
    `(function (exports, require, module, __filename, __dirname) {\n${compileModule(fixture, relativePath)}\n})`,
    { filename },
  ).runInNewContext({ console, process, setTimeout });
  wrapper(
    moduleRecord.exports,
    requireModule,
    moduleRecord,
    filename,
    path.dirname(filename),
  );

  return { exports: moduleRecord.exports, loadedStylesheets, stateChanges };
}

function loadConfig(fixture, relativePath = 'modern.config.ts') {
  const executed = executeModule(fixture, relativePath);
  return executed.exports.default ?? executed.exports;
}

function pluginKinds(config) {
  return (config.plugins ?? []).map(plugin => plugin.kind);
}

function countPlugin(config, kind) {
  return pluginKinds(config).filter(value => value === kind).length;
}

function collectRenderedText(node) {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(collectRenderedText).join('');
  if (typeof node.type === 'function') {
    return collectRenderedText(node.type(node.props ?? {}));
  }
  return collectRenderedText(node.props?.children);
}

async function executePage(fixture, relativePath, apiRelativePath) {
  const apiCalls = [];
  const moduleOverrides = {};
  if (apiRelativePath) {
    const api = executeModule(fixture, apiRelativePath).exports;
    const specifier = `@api/${path.basename(apiRelativePath, '.ts')}`;
    moduleOverrides[specifier] = {
      ...api,
      get: (...args) => {
        apiCalls.push(args);
        return api.get(...args);
      },
    };
  }
  const runtime = { loadedStylesheets: [], stateChanges: [] };
  const page = executeModule(fixture, relativePath, {
    moduleOverrides,
    runtime,
  });
  const component = page.exports.default;
  const tree = component();
  await Promise.resolve();
  await Promise.resolve();
  return {
    apiCalls,
    loadedStylesheets: runtime.loadedStylesheets,
    renderedText: collectRenderedText(tree),
    stateChanges: runtime.stateChanges,
    tree,
  };
}

try {
  // ===== BFF：未启用 → 启用 =====
  console.log('== feature-enable bff (v3-app-no-bff) ==');
  const a = prepare('v3-app-no-bff');
  check(
    '[provenance] 含 PROVENANCE.md（裁剪自 create 模板）',
    a.has('PROVENANCE.md'),
  );

  const scanOut = execFileSync(
    'node',
    [path.join(SCRIPTS, 'scan.mjs'), a.work],
    {
      encoding: 'utf8',
    },
  );
  check('scan 判定 v3', /\(v3\)/.test(scanOut));
  check('scan: bff 在能力矩阵且未启用', /bff（.*）：未启用/.test(scanOut));
  check(
    'scan: 能力矩阵含 server/tailwindcss/styled-components（不再只 bff/ssg）',
    /server（/.test(scanOut) &&
      /tailwindcss（/.test(scanOut) &&
      /styled-components（/.test(scanOut),
  );
  check(
    'scan: microFrontend 不在「可启用项」矩阵里（按张翔反馈移除）',
    !/microFrontend（/.test(scanOut),
  );

  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'bff', a.work], {
    encoding: 'utf8',
  });

  const pkg = JSON.parse(a.read('package.json'));
  const appToolsVer = pkg.devDependencies['@modern-js/app-tools'];
  check(
    '[auto] 新增 @modern-js/plugin-bff，且版本与 app-tools 一致',
    pkg.dependencies['@modern-js/plugin-bff'] === appToolsVer,
  );

  const config = loadConfig(a);
  check(
    '[auto] config 运行时按顺序注册 app-tools 与 BFF 插件',
    JSON.stringify(pluginKinds(config)) ===
      JSON.stringify(['app-tools', 'bff']),
  );
  check('[auto] BFF 插件只注册一次', countPlugin(config, 'bff') === 1);

  const tsconfig = JSON.parse(a.read('tsconfig.json'));
  check(
    '[auto] tsconfig 加 @api/* 别名',
    JSON.stringify(tsconfig.compilerOptions.paths['@api/*']) ===
      JSON.stringify(['./api/lambda/*']),
  );
  check(
    '[auto] tsconfig include 加 api（保留原有 src 等）',
    tsconfig.include.includes('api') && tsconfig.include.includes('src'),
  );
  check(
    '[provenance] tsconfig 原有 @/* 别名保留',
    JSON.stringify(tsconfig.compilerOptions.paths['@/*']) ===
      JSON.stringify(['./src/*']),
  );

  const generatedApi = executeModule(a, 'api/lambda/hello.ts').exports;
  check(
    '[auto] scaffold API 暴露可调用的 get handler',
    a.has('api/lambda/hello.ts') && typeof generatedApi.get === 'function',
  );
  // v3-app-no-bff 的首页是自定义页（非默认模板）→ 不改首页、新建 bff-demo 路由示例
  check(
    '[auto] 自定义首页未改动 → 新建 src/routes/bff-demo/page.tsx',
    a.has('src/routes/bff-demo/page.tsx'),
  );
  const bffDemo = await executePage(
    a,
    'src/routes/bff-demo/page.tsx',
    'api/lambda/hello.ts',
  );
  check(
    '[e2e] bff-demo 页挂载后调用 scaffold API 并提交响应状态',
    bffDemo.apiCalls.length === 1 && bffDemo.stateChanges.length === 1,
  );

  const report = a.report();
  check('report.changed 含 5 项自动改写', report.changed.length === 5);
  check(
    'report.manual 为空（干净 v3 app 可全自动）',
    report.manual.length === 0,
  );
  check(
    '默认不带 --install：report.install 为 null（install 不无条件默认）',
    report.install === null || report.install === undefined,
  );

  // ===== 幂等：再次 enable 不重复改写 =====
  console.log('== feature-enable bff idempotent (re-run) ==');
  const re = execFileSync(
    'node',
    [path.join(SCRIPTS, 'enable.mjs'), 'bff', a.work, '--json'],
    { encoding: 'utf8' },
  );
  const reReport = JSON.parse(re);
  check('幂等：第二次 enable 无 changed', reReport.changed.length === 0);
  check(
    '幂等：提示已启用、未重复改写',
    /已启用/.test(reReport.manual.join('\n')),
  );
  const config2 = loadConfig(a);
  check('幂等：BFF 插件仍只注册一次', countPlugin(config2, 'bff') === 1);

  // report 含 deprecated（stale-doc）分层
  check(
    '[stale-doc] report.deprecated 标注 modern new/upgrade 已移除',
    Boolean(
      report.deprecated?.removedCommands?.includes('modern new') &&
        /other\.md/.test(report.deprecated?.evidence ?? ''),
    ),
  );

  // ===== 负向 1：v2 项目（semver 2.x）→ enable 中止、零改动 =====
  console.log('== guard: v2 app (semver 2.x) must abort ==');
  const v2 = prepare('v2-app-needs-migrate');
  let v2Blocked = false;
  try {
    execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'bff', v2.work], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch {
    v2Blocked = true;
  }
  check('[guard] v2 项目 enable 非 0 中止', v2Blocked);
  check('[guard] v2 项目未生成 api/（零改动）', !v2.has('api/lambda/index.ts'));
  check(
    '[guard] v2 项目未写 plugin-bff 依赖',
    !JSON.parse(v2.read('package.json')).dependencies['@modern-js/plugin-bff'],
  );
  check(
    '[guard] v2 项目无 report（未执行）',
    !v2.has('.agents/runs/modernjs-feature-enable/report.json'),
  );

  // ===== 负向 2：workspace:* + v2-only 信号 → 按 v2 中止 =====
  console.log('== guard: workspace + v2 signal must abort ==');
  const wv2 = prepare('v2-workspace-signal');
  let wv2Blocked = false;
  try {
    execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'bff', wv2.work], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch {
    wv2Blocked = true;
  }
  check('[guard] workspace+v2信号 enable 中止（不误判 v3）', wv2Blocked);

  // ===== 负向 3：link: 协议 → enable 放行，但 plugin-bff 进 manual（不照搬错路径）=====
  console.log('== link: protocol → mapped dep manual ==');
  const lk = prepare('v3-app-bff-link');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'bff', lk.work], {
    encoding: 'utf8',
  });
  const lkPkg = JSON.parse(lk.read('package.json'));
  check(
    '[guard] link: 协议未把 app-tools 路径写给 plugin-bff',
    !lkPkg.dependencies['@modern-js/plugin-bff'],
  );
  check(
    '[guard] link: 协议补依赖进 manual',
    /link:.*手动添加.*plugin-bff/s.test(lk.report().manual.join('\n')),
  );
  check(
    '[guard] link: 既有依赖仍可让 config 注册 BFF 插件',
    countPlugin(loadConfig(lk), 'bff') === 1,
  );

  // ===== SSG：未启用 → 启用（clean v3 app）=====
  console.log('== feature-enable ssg (v3-app-no-bff) ==');
  const s = prepare('v3-app-no-bff');
  const sScan = execFileSync('node', [path.join(SCRIPTS, 'scan.mjs'), s.work], {
    encoding: 'utf8',
  });
  check('scan: ssg 在能力矩阵且未启用', /ssg（.*）：未启用/.test(sScan));
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'ssg', s.work], {
    encoding: 'utf8',
  });
  const sPkg = JSON.parse(s.read('package.json'));
  check(
    '[auto] 新增 @modern-js/plugin-ssg，版本与 app-tools 一致',
    sPkg.dependencies['@modern-js/plugin-ssg'] ===
      sPkg.devDependencies['@modern-js/app-tools'],
  );
  const sConfig = loadConfig(s);
  check(
    '[auto] config 运行时注册 SSG 插件',
    JSON.stringify(pluginKinds(sConfig)) ===
      JSON.stringify(['app-tools', 'ssg']),
  );
  check('[auto] output.ssg 运行时为 true', sConfig.output?.ssg === true);
  check('[auto] SSG 插件只注册一次', countPlugin(sConfig, 'ssg') === 1);

  // SSG：已有 output 块 → 合并 ssg、保留其它 key
  console.log('== feature-enable ssg (existing output → merge) ==');
  const so = prepare('v3-app-ssg-output');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'ssg', so.work], {
    encoding: 'utf8',
  });
  const soConfig = loadConfig(so);
  check(
    '[auto] 既有 output.polyfill 语义保留 + 启用 SSG',
    soConfig.output?.ssg === true && soConfig.output?.polyfill === 'usage',
  );

  // ===== CJS：module.exports/require 配置插 require 绑定（梅长苏 blocker）=====
  console.log('== feature-enable bff (CJS module.exports config) ==');
  const cjs = prepare('v3-app-cjs-config');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'bff', cjs.work], {
    encoding: 'utf8',
  });
  const cjsConfig = loadConfig(cjs, 'modern.config.js');
  check(
    '[auto] CJS 配置可由 CommonJS 运行时直接加载并注册 BFF',
    countPlugin(cjsConfig, 'bff') === 1,
  );
  check(
    '[auto] CJS 保留 app-tools 后追加 BFF 插件',
    JSON.stringify(pluginKinds(cjsConfig)) ===
      JSON.stringify(['app-tools', 'bff']),
  );
  check(
    '[auto] CJS 导出保持可消费的配置对象',
    typeof cjsConfig === 'object' && Array.isArray(cjsConfig.plugins),
  );
  check(
    '[auto] CJS config report.manual 无「绑定缺失」类残留',
    !/undefined|未导入/.test(cjs.report().manual.join('\n')),
  );

  // ===== call 但缺绑定（半启用坏态）→ 补齐绑定、不重复加调用 =====
  console.log('== feature-enable bff (call without binding → repair) ==');
  const nb = prepare('v3-app-bff-no-binding');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'bff', nb.work], {
    encoding: 'utf8',
  });
  const nbConfig = loadConfig(nb);
  check(
    '[repair] 修复后配置可执行并注册 BFF 插件',
    countPlugin(nbConfig, 'bff') === 1,
  );
  check(
    '[repair] BFF 插件不重复（仍只 1 个运行时实例）',
    pluginKinds(nbConfig).filter(kind => kind === 'bff').length === 1,
  );

  // ===== 绑定解析 blocker（刺儿头 + 梅长苏）=====
  // B1：普通字符串里的伪 import 不算绑定 → 必须插入真实 import，字符串原样
  console.log('== binding: string fake import ≠ real binding ==');
  const sf = prepare('v3-app-string-fake-import');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'bff', sf.work], {
    encoding: 'utf8',
  });
  const sfConfig = loadConfig(sf);
  check(
    '字符串中的伪 import 不影响真实 BFF 插件注册',
    countPlugin(sfConfig, 'bff') === 1,
  );
  check(
    '配置修复后仍保留原 app-tools 行为',
    JSON.stringify(pluginKinds(sfConfig)) ===
      JSON.stringify(['app-tools', 'bff']),
  );

  // B2：specifier 在但缺 export + 有调用 → 把 export 加进现有大括号，调用不重复
  console.log(
    '== binding: specifier present, export missing → add to braces ==',
  );
  const sm = prepare('v3-app-bff-specifier-missing');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'bff', sm.work], {
    encoding: 'utf8',
  });
  const smConfig = loadConfig(sm);
  check(
    '已有同包绑定时，修复后配置可执行并注册 BFF',
    countPlugin(smConfig, 'bff') === 1,
  );
  check(
    'BFF 运行时实例不重复（仍 1 个）',
    pluginKinds(smConfig).filter(kind => kind === 'bff').length === 1,
  );

  // B3：ESM alias 已启用 → 幂等（不重复 append alias 调用）
  console.log('== idempotent: ESM alias already enabled ==');
  const al = prepare('v3-app-bff-alias');
  const alOut = execFileSync(
    'node',
    [path.join(SCRIPTS, 'enable.mjs'), 'bff', al.work, '--json'],
    { encoding: 'utf8' },
  );
  check(
    'alias 已启用：插件部分进 manual（已启用），不重复改 config',
    /已启用/.test(JSON.parse(alOut).manual.join('\n')),
  );
  check(
    'alias 已启用时 BFF 运行时实例仍只有 1 个',
    countPlugin(loadConfig(al), 'bff') === 1,
  );

  // B4：SSG 半启用（有 plugin、缺 output.ssg）→ 补齐 output.ssg
  console.log(
    '== ssg: half-enabled (plugin, no output.ssg) → add output.ssg ==',
  );
  const sh = prepare('v3-app-ssg-half');
  const shScan = execFileSync(
    'node',
    [path.join(SCRIPTS, 'scan.mjs'), sh.work],
    {
      encoding: 'utf8',
    },
  );
  check('scan: 半启用 SSG 不被标为已启用', /ssg（.*）：未启用/.test(shScan));
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'ssg', sh.work], {
    encoding: 'utf8',
  });
  const shConfig = loadConfig(sh);
  check('补齐 output.ssg: true', shConfig.output?.ssg === true);
  check(
    'SSG 插件运行时实例不重复（仍 1 个）',
    countPlugin(shConfig, 'ssg') === 1,
  );

  // B5：type-only import 不算 value 绑定 → 另插一条 value import，type import 原样
  console.log('== binding: import type ≠ value binding ==');
  const ti = prepare('v3-app-bff-type-import');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'bff', ti.work], {
    encoding: 'utf8',
  });
  const tiConfig = loadConfig(ti);
  check(
    'type-only 绑定不会妨碍 TypeScript 配置编译执行',
    typeof tiConfig === 'object',
  );
  check('修复后提供可调用的 BFF 插件实例', countPlugin(tiConfig, 'bff') === 1);
  check(
    '插件运行时顺序保留 app-tools 在前',
    JSON.stringify(pluginKinds(tiConfig)) ===
      JSON.stringify(['app-tools', 'bff']),
  );

  // B6：output.ssg: false 不算已启用 → scan 未启用 + enable 翻成 true
  console.log('== ssg: output.ssg false ≠ enabled → flip to true ==');
  const sff = prepare('v3-app-ssg-false');
  const sffScan = execFileSync(
    'node',
    [path.join(SCRIPTS, 'scan.mjs'), sff.work],
    { encoding: 'utf8' },
  );
  check(
    'scan: output.ssg:false 不被标为已启用',
    /ssg（.*）：未启用/.test(sffScan),
  );
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'ssg', sff.work], {
    encoding: 'utf8',
  });
  const sffConfig = loadConfig(sff);
  check(
    'output.ssg: false → true（按启用意图）',
    sffConfig.output?.ssg === true,
  );
  check('运行时不再暴露禁用的 SSG 值', sffConfig.output?.ssg !== false);

  // B7：output.ssg 结构化改写——只翻顶层真实 ssg，不动字符串/注释/嵌套 experimental.ssg
  console.log(
    '== ssg: structural output.ssg (string/comment/nested untouched) ==',
  );
  const to = prepare('v3-app-ssg-tricky-output');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'ssg', to.work], {
    encoding: 'utf8',
  });
  const toConfig = loadConfig(to);
  check('顶层 output.ssg false → true', toConfig.output?.ssg === true);
  check(
    'output.note 的业务值保持不变',
    toConfig.output?.note === 'ssg: false in a string',
  );
  check(
    '嵌套 experimental.ssg 语义保持 false',
    toConfig.output?.experimental?.ssg === false,
  );

  // B8：output 值非对象字面量（动态表达式）→ 进 manual，不改坏表达式
  console.log('== ssg: output value is expression → manual (untouched) ==');
  const oe = prepare('v3-app-ssg-output-expr');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'ssg', oe.work], {
    encoding: 'utf8',
  });
  const oeConfig = loadConfig(oe);
  check(
    '动态 output 表达式的运行时结果保持禁用',
    oeConfig.output?.ssg === false,
  );
  check(
    'output 非对象字面量进 manual',
    /output 值不是对象字面量/.test(oe.report().manual.join('\n')),
  );

  // B9：output.ssg 值为 undefined（非启用字面量）→ scan 未启用 + enable 翻 true
  console.log('== ssg: output.ssg undefined ≠ enabled → flip ==');
  const su = prepare('v3-app-ssg-undefined');
  const suScan = execFileSync(
    'node',
    [path.join(SCRIPTS, 'scan.mjs'), su.work],
    { encoding: 'utf8' },
  );
  check(
    'scan: output.ssg undefined 不被标已启用',
    /ssg（.*）：未启用/.test(suScan),
  );
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'ssg', su.work], {
    encoding: 'utf8',
  });
  const suConfig = loadConfig(su);
  check('output.ssg undefined → true', suConfig.output?.ssg === true);
  check('运行时不再暴露 undefined SSG 值', suConfig.output?.ssg !== undefined);

  // B10：output 值是数组字面量（非对象）→ 同样进 manual、不下钻改写
  console.log('== ssg: output value is array literal → manual (untouched) ==');
  const oa = prepare('v3-app-ssg-output-array');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'ssg', oa.work], {
    encoding: 'utf8',
  });
  const oaConfig = loadConfig(oa);
  check(
    '数组 output 的运行时结构和值保持不变',
    Array.isArray(oaConfig.output) && oaConfig.output[0]?.ssg === false,
  );
  check(
    'output 数组进 manual（未误改成对象）',
    /output 值不是对象字面量/.test(oa.report().manual.join('\n')) &&
      Array.isArray(oaConfig.output),
  );

  // B11：output.ssg 值为数组（类型非法 boolean|object）→ scan 不算已启用 + enable 进 manual
  console.log('== ssg: output.ssg array value is invalid → manual ==');
  const av = prepare('v3-app-ssg-array-value');
  const avScan = execFileSync(
    'node',
    [path.join(SCRIPTS, 'scan.mjs'), av.work],
    { encoding: 'utf8' },
  );
  check('scan: output.ssg 数组值不算已启用', /ssg（.*）：未启用/.test(avScan));
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'ssg', av.work], {
    encoding: 'utf8',
  });
  const avConfig = loadConfig(av);
  check(
    'output.ssg 数组值的运行时结构保持不变',
    Array.isArray(avConfig.output?.ssg),
  );
  check(
    'output.ssg 数组值进 manual（非法字面量）',
    /非法字面量/.test(av.report().manual.join('\n')),
  );

  // B12：ssgByEntries 值语义（与 ssg 同一套）—— 源码 util.ts:117 / adapterSSR.ts:214
  console.log('== ssg: ssgByEntries value semantics ==');
  // (a) 空对象 {} → 源码忽略，回落普通 ssg → scan 未启用 + enable 补 ssg: true（保留空 ssgByEntries）
  const be = prepare('v3-app-ssg-byentries-empty');
  const beScan = execFileSync(
    'node',
    [path.join(SCRIPTS, 'scan.mjs'), be.work],
    { encoding: 'utf8' },
  );
  check('scan: ssgByEntries:{} 不算已启用', /ssg（.*）：未启用/.test(beScan));
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'ssg', be.work], {
    encoding: 'utf8',
  });
  const beConfig = loadConfig(be);
  check(
    'ssgByEntries:{} → 补 output.ssg: true（保留空映射）',
    beConfig.output?.ssg === true &&
      Object.keys(beConfig.output?.ssgByEntries ?? {}).length === 0,
  );

  // (b) 全 false → scan 未启用 + enable 进 manual、原样不动
  const bf = prepare('v3-app-ssg-byentries-false');
  const bfScan = execFileSync(
    'node',
    [path.join(SCRIPTS, 'scan.mjs'), bf.work],
    { encoding: 'utf8' },
  );
  check(
    'scan: ssgByEntries 全 false 不算已启用',
    /ssg（.*）：未启用/.test(bfScan),
  );
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'ssg', bf.work], {
    encoding: 'utf8',
  });
  const bfConfig = loadConfig(bf);
  check(
    'ssgByEntries 全 false → manual、不静默改写',
    /所有入口均为非启用值/.test(bf.report().manual.join('\n')) &&
      bfConfig.output?.ssgByEntries?.main === false &&
      bfConfig.output?.ssgByEntries?.home === false &&
      bfConfig.output?.ssg !== true,
  );

  // (c) 动态 entry 值 → scan 未启用 + enable 进 manual 要求人工确认
  const bd = prepare('v3-app-ssg-byentries-dynamic');
  const bdScan = execFileSync(
    'node',
    [path.join(SCRIPTS, 'scan.mjs'), bd.work],
    { encoding: 'utf8' },
  );
  check(
    'scan: ssgByEntries 动态值不算已启用',
    /ssg（.*）：未启用/.test(bdScan),
  );
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'ssg', bd.work], {
    encoding: 'utf8',
  });
  check(
    'ssgByEntries 动态值 → manual（要求人工确认）',
    /含动态\/无法静态确认/.test(bd.report().manual.join('\n')),
  );

  // (d) 任一 entry 为 true → 算已启用
  const bt = prepare('v3-app-ssg-byentries-true');
  const btScan = execFileSync(
    'node',
    [path.join(SCRIPTS, 'scan.mjs'), bt.work],
    { encoding: 'utf8' },
  );
  check(
    'scan: ssgByEntries 含 true 算已启用',
    /ssg（.*）：已启用/.test(btScan),
  );
  // 已启用文案按实际字段精确化：ssgByEntries 启用时不写成 output.ssg
  const btRe = execFileSync(
    'node',
    [path.join(SCRIPTS, 'enable.mjs'), 'ssg', bt.work, '--json'],
    { encoding: 'utf8' },
  );
  check(
    'ssgByEntries 已启用文案点名 ssgByEntries（不误写 output.ssg）',
    /ssgByEntries（已有入口启用）/.test(JSON.parse(btRe).manual.join('\n')),
  );

  // ===== D. BFF 端到端示例：默认模板首页 → 安全接首页 =====
  console.log('== D1. bff e2e: default template homepage → patch 首页 ==');
  const dp = prepare('v3-app-default-page');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'bff', dp.work], {
    encoding: 'utf8',
  });
  const dpBehavior = await executePage(
    dp,
    'src/routes/page.tsx',
    'api/lambda/hello.ts',
  );
  check(
    '默认模板首页挂载后调用 BFF API 并更新状态（未走 bff-demo）',
    dpBehavior.apiCalls.length === 1 &&
      dpBehavior.stateChanges.length === 1 &&
      !dp.has('src/routes/bff-demo/page.tsx'),
  );
  const dpApi = executeModule(dp, 'api/lambda/hello.ts').exports;
  check(
    'api/lambda/hello.ts 暴露可执行的 get handler',
    typeof dpApi.get === 'function' && (await dpApi.get()) !== undefined,
  );
  // 幂等：再跑一次首页不重复改、不报 changed
  const dpRe = execFileSync(
    'node',
    [path.join(SCRIPTS, 'enable.mjs'), 'bff', dp.work, '--json'],
    { encoding: 'utf8' },
  );
  check(
    '幂等：默认页已接入后再跑 changed 为空',
    JSON.parse(dpRe).changed.length === 0,
  );

  // ===== D2. BFF：已有 api 不覆盖，复用真实函数 =====
  console.log('== D2. bff e2e: existing api reused (no overwrite) ==');
  const ea = prepare('v3-app-bff-existing-api');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'bff', ea.work], {
    encoding: 'utf8',
  });
  const eaApi = executeModule(ea, 'api/lambda/hello.ts').exports;
  check(
    '已有 API 的运行时响应未被覆盖',
    (await eaApi.get()) === 'existing api response',
  );
  check(
    '复用已有 api 进 manual（说明未改用户 API）',
    /复用已有 api\/lambda\/hello/.test(ea.report().manual.join('\n')),
  );
  check(
    '默认首页挂载后调用复用的 API',
    (await executePage(ea, 'src/routes/page.tsx', 'api/lambda/hello.ts'))
      .apiCalls.length === 1,
  );

  // ===== D3. server 骨架化 =====
  console.log('== D3. enable server (scaffold) ==');
  const sv = prepare('v3-app-no-bff');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'server', sv.work], {
    encoding: 'utf8',
  });
  const svServer = sv.has('server/modern.server.ts')
    ? executeModule(sv, 'server/modern.server.ts').exports.default
    : null;
  check(
    'server: 加 @modern-js/server-runtime + 可加载的 server 配置契约',
    JSON.parse(sv.read('package.json')).dependencies[
      '@modern-js/server-runtime'
    ] &&
      Array.isArray(svServer?.middlewares) &&
      Array.isArray(svServer?.renderMiddlewares) &&
      Array.isArray(svServer?.plugins) &&
      typeof svServer?.onError === 'function',
  );
  check(
    'server: 骨架可执行且没有半成品 middleware handler',
    svServer.middlewares.length === 0 &&
      svServer.renderMiddlewares.length === 0 &&
      svServer.plugins.length === 0 &&
      svServer.onError(new Error('fixture'), {}) === undefined,
  );
  check(
    'server: TypeScript 编译与运行时加载均成功',
    typeof svServer === 'object',
  );
  check(
    'server: 业务语义进 manual（不声称已迁好）',
    /业务语义需人工补全/.test(sv.report().manual.join('\n')),
  );
  const svRe = execFileSync(
    'node',
    [path.join(SCRIPTS, 'enable.mjs'), 'server', sv.work, '--json'],
    { encoding: 'utf8' },
  );
  check('server 幂等：再跑不重复生成', JSON.parse(svRe).changed.length === 0);

  // ===== D4. styled-components（插件式自动化）=====
  console.log('== D4. enable styled-components ==');
  const sc = prepare('v3-app-no-bff');
  execFileSync(
    'node',
    [path.join(SCRIPTS, 'enable.mjs'), 'styled-components', sc.work],
    { encoding: 'utf8' },
  );
  check(
    'styled-components: 加依赖 + 运行时注册插件',
    JSON.parse(sc.read('package.json')).dependencies[
      '@modern-js/plugin-styled-components'
    ] && countPlugin(loadConfig(sc), 'styled-components') === 1,
  );

  // ===== D5. tailwindcss（Rsbuild 原生脚手架）=====
  console.log('== D5. enable tailwindcss (Rsbuild-native scaffold) ==');
  const tw = prepare('v3-app-no-bff');
  execFileSync(
    'node',
    [path.join(SCRIPTS, 'enable.mjs'), 'tailwindcss', tw.work],
    {
      encoding: 'utf8',
    },
  );
  const twPkg = JSON.parse(tw.read('package.json'));
  check(
    'tailwindcss: 装依赖并生成 Rsbuild/PostCSS 配置资产',
    twPkg.devDependencies.tailwindcss &&
      tw.has('tailwind.config.ts') &&
      tw.has('postcss.config.cjs') &&
      tw.has('src/tailwind.css'),
  );
  // 关键：CSS 自动接入根布局，用正确相对路径 `../tailwind.css`（不是会 build 失败的 './tailwind.css'）
  const twLayout = await executePage(tw, 'src/routes/layout.tsx');
  check(
    'tailwindcss: 根布局执行时加载可解析的全局样式资产',
    twLayout.loadedStylesheets.includes(path.join(tw.work, 'src/tailwind.css')),
  );
  check(
    'tailwindcss: v4 分支说明进 manual',
    /Tailwind v4/.test(tw.report().manual.join('\n')),
  );
  // 接入后 scan 视为已启用；未接入（无 layout 自动接入路径）则应是 partial 而非已启用
  const twScan = execFileSync(
    'node',
    [path.join(SCRIPTS, 'scan.mjs'), tw.work],
    {
      encoding: 'utf8',
    },
  );
  check(
    'tailwindcss: CSS 已接入 → scan 已启用（接入前为 partial 而非误报已启用）',
    /tailwindcss（.*）：已启用/.test(twScan),
  );

  // ===== D6. microFrontend：不自动化 → 可执行 checklist + 原因，不改文件 =====
  console.log('== D6. enable microFrontend (manual plan checklist) ==');
  const mf = prepare('v3-app-no-bff');
  const mfConfigBefore = JSON.stringify(loadConfig(mf));
  const mfOut = execFileSync(
    'node',
    [path.join(SCRIPTS, 'enable.mjs'), 'microFrontend', mf.work, '--json'],
    { encoding: 'utf8' },
  );
  const mfReport = JSON.parse(mfOut);
  check(
    'microFrontend: tier=manual、changed 为空（未改文件）',
    mfReport.tier === 'manual' && mfReport.changed.length === 0,
  );
  check(
    'microFrontend: 输出原因 + 可执行 checklist（非 unsupported）',
    /架构决策/.test(mfReport.manual.join('\n')) &&
      mfReport.manual.some(m => /\[1\]/.test(m)),
  );
  check(
    'microFrontend: 明确「未改任何文件 + 架构方案」、complete=false、不报启用成功',
    /未改任何文件/.test(mfReport.manual.join('\n')) &&
      mfReport.complete === false,
  );
  check(
    'microFrontend: modern.config 运行时语义保持不变',
    JSON.stringify(loadConfig(mf)) === mfConfigBefore,
  );

  // ===== D7. BFF：已有 api/lambda/index.ts → import @api/index（不是裸 @api，alias 才解析得到）=====
  console.log('== D7. bff e2e: existing index.ts → @api/index import ==');
  const ix = prepare('v3-app-bff-index-api');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'bff', ix.work], {
    encoding: 'utf8',
  });
  check(
    'index.ts alias 可解析，首页挂载后调用复用 API',
    (await executePage(ix, 'src/routes/page.tsx', 'api/lambda/index.ts'))
      .apiCalls.length === 1,
  );
  const ixApi = executeModule(ix, 'api/lambda/index.ts').exports;
  check(
    'index.ts 用户 API 的运行时响应未被覆盖',
    (await ixApi.get()) === 'index api response',
  );

  // ===== D8. BFF 页面：自定义业务首页（非 generator 模板）不被覆盖 → 走 bff-demo =====
  console.log('== D8. bff e2e: custom welcome homepage NOT overwritten ==');
  const cw = prepare('v3-app-custom-welcome');
  const cwBefore = await executePage(cw, 'src/routes/page.tsx');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'bff', cw.work], {
    encoding: 'utf8',
  });
  const cwAfter = await executePage(
    cw,
    'src/routes/page.tsx',
    'api/lambda/hello.ts',
  );
  check(
    '自定义 welcome 首页渲染结果保持不变且不会调用 API',
    cwAfter.renderedText === cwBefore.renderedText &&
      cwAfter.apiCalls.length === 0,
  );
  const cwDemo = await executePage(
    cw,
    'src/routes/bff-demo/page.tsx',
    'api/lambda/hello.ts',
  );
  check(
    '改走独立 bff-demo 路由，挂载后调用 scaffold API',
    cw.has('src/routes/bff-demo/page.tsx') &&
      cwDemo.apiCalls.length === 1 &&
      cwDemo.stateChanges.length === 1,
  );

  // ===== D9. styled-components：补 peer styled-components；缺 peer 不算完整启用 =====
  console.log('== D9. styled-components peer + completeness ==');
  const scp = prepare('v3-app-no-bff');
  execFileSync(
    'node',
    [path.join(SCRIPTS, 'enable.mjs'), 'styled-components', scp.work],
    { encoding: 'utf8' },
  );
  const scpPkg = JSON.parse(scp.read('package.json'));
  check(
    'styled-components: 补装 peer styled-components 到 dependencies',
    Boolean(scpPkg.dependencies['styled-components']),
  );
  // scan：缺 peer 时不算完整启用（删掉 peer 再扫）
  const scpNoPeer = prepare('v3-app-no-bff');
  execFileSync(
    'node',
    [path.join(SCRIPTS, 'enable.mjs'), 'styled-components', scpNoPeer.work],
    { encoding: 'utf8' },
  );
  const noPeerPkgPath = path.join(scpNoPeer.work, 'package.json');
  const noPeerPkg = JSON.parse(scpNoPeer.read('package.json'));
  delete noPeerPkg.dependencies['styled-components'];
  fs.writeFileSync(noPeerPkgPath, `${JSON.stringify(noPeerPkg, null, 2)}\n`);
  const noPeerScan = execFileSync(
    'node',
    [path.join(SCRIPTS, 'scan.mjs'), scpNoPeer.work],
    { encoding: 'utf8' },
  );
  check(
    'scan: 缺 styled-components peer → 不标已启用',
    /styled-components（.*）：未启用/.test(noPeerScan),
  );

  // ===== D10. scaffold tier（tailwind/server）：依赖进 changed、report.tier=scaffold（非完整 auto）=====
  console.log('== D10. scaffold tier + deps in changed ==');
  const tw2 = prepare('v3-app-no-bff');
  const tw2Out = execFileSync(
    'node',
    [path.join(SCRIPTS, 'enable.mjs'), 'tailwindcss', tw2.work, '--json'],
    { encoding: 'utf8' },
  );
  const tw2Report = JSON.parse(tw2Out);
  check(
    'tailwindcss: 依赖改动进 changed（tailwindcss/postcss/autoprefixer）',
    tw2Report.changed.some(c => /tailwindcss@/.test(c)) &&
      tw2Report.changed.some(c => /autoprefixer@/.test(c)),
  );
  check(
    'tailwindcss: report.tier=scaffold、complete=false（非完整 auto 启用）',
    tw2Report.tier === 'scaffold' && tw2Report.complete === false,
  );
  const sv2 = prepare('v3-app-no-bff');
  const sv2Out = execFileSync(
    'node',
    [path.join(SCRIPTS, 'enable.mjs'), 'server', sv2.work, '--json'],
    { encoding: 'utf8' },
  );
  check(
    'server: report.tier=scaffold（非 auto）',
    JSON.parse(sv2Out).tier === 'scaffold',
  );

  // ===== D11. styled-components 半启用：config 有插件但缺 peer → 仍补 peer（不直接 return）=====
  console.log(
    '== D11. styled-components half-enabled (plugin present, peer missing) ==',
  );
  const shc = prepare('v3-app-styled-half');
  const shScan1 = execFileSync(
    'node',
    [path.join(SCRIPTS, 'scan.mjs'), shc.work],
    {
      encoding: 'utf8',
    },
  );
  check(
    'scan: 有插件但缺 peer → 未启用（半启用不算完整）',
    /styled-components（.*）：未启用/.test(shScan1),
  );
  const shOut = execFileSync(
    'node',
    [path.join(SCRIPTS, 'enable.mjs'), 'styled-components', shc.work, '--json'],
    { encoding: 'utf8' },
  );
  const shReport = JSON.parse(shOut);
  check(
    'enable: 半启用态补 peer（changed 含 styled-components）',
    shReport.changed.some(c => /styled-components@/.test(c)) &&
      Boolean(
        JSON.parse(shc.read('package.json')).dependencies['styled-components'],
      ),
  );
  check(
    'enable: styled-components 运行时插件实例仍只有 1 个',
    countPlugin(loadConfig(shc), 'styled-components') === 1,
  );
  const shScan2 = execFileSync(
    'node',
    [path.join(SCRIPTS, 'scan.mjs'), shc.work],
    {
      encoding: 'utf8',
    },
  );
  check(
    'scan: 补 peer 后 → 已启用',
    /styled-components（.*）：已启用/.test(shScan2),
  );

  // ===== D12. BFF：已有 `export async function get` 也要复用（不只 export const get）=====
  console.log(
    '== D12. bff e2e: existing `export async function get` reused ==',
  );
  const fg = prepare('v3-app-bff-fn-get');
  execFileSync('node', [path.join(SCRIPTS, 'enable.mjs'), 'bff', fg.work], {
    encoding: 'utf8',
  });
  const fgApi = executeModule(fg, 'api/lambda/hello.ts').exports;
  check(
    '函数式 get handler 的运行时响应被复用（未新建 bff-demo.ts）',
    (await fgApi.get()) === 'fn-get api response' &&
      !fg.has('api/lambda/bff-demo.ts'),
  );
  check(
    '默认首页挂载后调用复用的函数式 get handler',
    (await executePage(fg, 'src/routes/page.tsx', 'api/lambda/hello.ts'))
      .apiCalls.length === 1,
  );

  // ===== D13. --install 失败要诚实：非 0 退出 + report 给 stderr/补救命令，不报「一步到位完成」=====
  console.log(
    '== D13. --install honest failure (broken dep → non-zero + hint) ==',
  );
  const inf = prepare('v3-app-install-fail');
  let infThrew = false;
  let infOut = '';
  try {
    infOut = execFileSync(
      'node',
      [
        path.join(SCRIPTS, 'enable.mjs'),
        'styled-components',
        inf.work,
        '--install',
        '--json',
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
  } catch (e) {
    infThrew = true; // execFileSync 在非 0 退出时抛错 → 验证「失败非 0」
    infOut = e.stdout || '';
  }
  check('[install] 安装失败时进程非 0 退出（不把失败当完成）', infThrew);
  let infReport = null;
  try {
    infReport = JSON.parse(infOut);
  } catch {
    infReport = inf.report();
  }
  check(
    '[install] report.install.ok=false 且带补救提示（approve-builds / 手动安装）',
    infReport.install &&
      infReport.install.ok === false &&
      /approve-builds|手动安装/.test(infReport.install.hint || ''),
  );
  check(
    '[install] 安装失败进 manual（含 stderr），但源文件改动已落盘',
    /依赖安装失败/.test(infReport.manual.join('\n')) &&
      countPlugin(loadConfig(inf), 'styled-components') === 1,
  );
  // 重试/幂等：插件已启用(enable 此次幂等)，再跑 --install 仍会装（不被 changed=0 门控），失败仍非 0
  let infRetryThrew = false;
  let infRetryOut = '';
  try {
    infRetryOut = execFileSync(
      'node',
      [
        path.join(SCRIPTS, 'enable.mjs'),
        'styled-components',
        inf.work,
        '--install',
        '--json',
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
  } catch (e) {
    infRetryThrew = true;
    infRetryOut = e.stdout || '';
  }
  let infRetry = null;
  try {
    infRetry = JSON.parse(infRetryOut);
  } catch {
    infRetry = inf.report();
  }
  check(
    '[install] 重试路径：enable 已幂等仍跑 --install（install 非 null）且失败仍非 0',
    infRetryThrew && infRetry.install && infRetry.install.ok === false,
  );

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
  console.log('✅ feature-enable skill 验证通过');
} finally {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
}
