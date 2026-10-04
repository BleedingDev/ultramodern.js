import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const maxLogBytes = 16 * 1024 * 1024;
const snapshotMessage = 'test: snapshot generated ERP-10 application source';
const mfTypesCommand = '$ ultramodern-create ultramodern mf-types';
const performanceCommand =
  '$ ultramodern-create ultramodern performance-readiness';

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(`Prior build attribution: ${message}`);
  }
}

function uniqueLine(lines, predicate, label) {
  const matches = lines.filter(predicate);
  assertCondition(matches.length === 1, `${label} must occur exactly once`);
  return matches[0];
}

function validateApps(apps, platform = 'node') {
  assertCondition(Array.isArray(apps), 'apps must be an array');
  assertCondition(
    apps.length === 11 &&
      apps.filter(app => app?.kind === 'vertical').length === 10 &&
      apps.filter(app => app?.kind === 'shell').length === 1,
    'ERP-10 requires ten verticals and one shell',
  );
  const ids = new Set();
  const paths = new Set();
  for (const app of apps) {
    assertCondition(
      typeof app.id === 'string' &&
        /^[^\s/\\]+$/u.test(app.id) &&
        !ids.has(app.id),
      'app IDs must be unique non-empty tokens',
    );
    ids.add(app.id);
    assertCondition(
      typeof app.path === 'string' &&
        /^[^\s\\]+$/u.test(app.path) &&
        !path.isAbsolute(app.path) &&
        app.path
          .split('/')
          .every(part => part && !['.', '..'].includes(part)) &&
        !paths.has(app.path),
      `${app.id} must have a unique workspace-relative path`,
    );
    paths.add(app.path);
    const target = platform === 'cloudflare' ? 'cloudflare-dist' : 'dist';
    const build =
      platform === 'cloudflare'
        ? 'cross-env MODERNJS_DEPLOY=cloudflare ultramodern build'
        : 'ultramodern build';
    const verify =
      platform === 'cloudflare'
        ? ` && ultramodern-create ultramodern cloudflare-output-verify --app ${app.id}`
        : '';
    assertCondition(
      typeof app.buildScript === 'string' &&
        app.buildScript ===
          `pnpm --dir ../.. exec ultramodern-create ultramodern public-surface --app ${app.id} --target ${target} --sync-route-metadata && ${build} && pnpm --dir ../.. exec ultramodern-create ultramodern public-surface --app ${app.id} --target ${target} && cross-env MODERNJS_DEPLOY=${platform} ultramodern deploy --skip-build${verify}`,
      `${app.id} build script must use the native ${platform} build/deploy chain`,
    );
    if (app.kind === 'vertical') {
      assertCondition(
        /^verticals\/[^/]+$/u.test(app.path),
        `${app.id} must be selected by the root vertical build filter`,
      );
    }
  }
}

/** Attributes existing command output; it does not create acceptance statuses. */
function parsePriorNodeBuildAttribution(
  logText,
  { projectDir, applicationSourceRevision, rootBuildScript, apps } = {},
) {
  assertCondition(
    typeof logText === 'string' &&
      Buffer.byteLength(logText, 'utf8') <= maxLogBytes &&
      !logText.includes('\0'),
    'log must be bounded UTF-8 text',
  );
  assertCondition(
    typeof projectDir === 'string' && path.isAbsolute(projectDir),
    'projectDir must be absolute',
  );
  const projectDirectory = path.resolve(projectDir);
  assertCondition(
    typeof applicationSourceRevision === 'string' &&
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(applicationSourceRevision),
    'applicationSourceRevision must be a full Git revision',
  );
  validateApps(apps);
  assertCondition(
    typeof rootBuildScript === 'string' &&
      rootBuildScript.length > 0 &&
      !/[\r\n]/u.test(rootBuildScript),
    'root build script is missing or invalid',
  );
  const shell = apps.find(app => app.kind === 'shell');
  const rootStages = rootBuildScript.split(/\s+&&\s+/u);
  const verticalStage = 'pnpm -r --filter "./verticals/*" run build';
  const shellStage = `pnpm --filter "./${shell.path}" run build`;
  const verticalIndex = rootStages.indexOf(verticalStage);
  assertCondition(
    verticalIndex >= 0 &&
      rootStages.filter(stage => stage === verticalStage).length === 1 &&
      rootStages[verticalIndex + 1] === shellStage &&
      rootStages[verticalIndex + 2] === 'pnpm mf:types' &&
      rootStages[verticalIndex + 3] === 'pnpm performance:readiness' &&
      rootStages.length === verticalIndex + 4,
    'root build must reach the shell and subsequent commands through &&',
  );
  const lines = logText.split('\n').map((text, index) => ({
    line: index + 1,
    text: stripVTControlCharacters(text).replace(/\r$/u, ''),
  }));
  const browserBoundary = lines.findIndex(
    item =>
      item.text.startsWith('[ultramodern-browser-smoke]') ||
      /^(?:\$ |Command failed: )node .*run-browser-smoke\.mjs(?:\s|$)/u.test(
        item.text,
      ),
  );
  const priorLines =
    browserBoundary === -1 ? lines : lines.slice(0, browserBoundary);
  const initialization = uniqueLine(
    priorLines,
    item => item.text.startsWith('Initialized empty Git repository in '),
    'Git initialization',
  );
  assertCondition(
    initialization.text ===
      `Initialized empty Git repository in ${projectDirectory}/.git/`,
    'Git initialization belongs to a different project',
  );
  const snapshot = uniqueLine(
    priorLines,
    item => item.text.endsWith(`] ${snapshotMessage}`),
    'application snapshot',
  );
  const snapshotRevision = /^\[[^\]\r\n]+ ([a-f0-9]{7,64})\] /u.exec(
    snapshot.text,
  )?.[1];
  assertCondition(
    snapshotRevision && applicationSourceRevision.startsWith(snapshotRevision),
    'snapshot revision differs from the retained application HEAD',
  );
  const rootBuild = uniqueLine(
    priorLines,
    item => item.text === `$ ${rootBuildScript}`,
    'root build command',
  );
  assertCondition(
    initialization.line < snapshot.line && snapshot.line < rootBuild.line,
    'project initialization, snapshot and root build are out of order',
  );
  const buildLines = priorLines.filter(item => item.line > rootBuild.line);
  for (const item of buildLines) {
    const payload = item.text.replace(/^[^\s]+ build: /u, '').trimStart();
    assertCondition(
      !/^(?:error(?:\s|:)|failed(?:\s|:|$)|ERR_PNPM_|ELIFECYCLE|Command failed:|Exit status [1-9]|Process exited with code [1-9])/iu.test(
        payload,
      ),
      `build failed at line ${item.line}`,
    );
    const prefixed = /^([^\s]+) build(?:\$ |: Done$)/u.exec(item.text);
    if (prefixed) {
      assertCondition(
        apps.some(app => app.kind === 'vertical' && app.path === prefixed[1]),
        `unexpected app command or completion at line ${item.line}`,
      );
    }
  }
  const commands = apps
    .filter(app => app.kind === 'vertical')
    .map(app => {
      const start = uniqueLine(
        buildLines,
        item => item.text.startsWith(`${app.path} build$ `),
        `${app.id} command`,
      );
      assertCondition(
        start.text === `${app.path} build$ ${app.buildScript}`,
        `${app.id} logged build script differs from its manifest`,
      );
      const done = uniqueLine(
        buildLines,
        item => item.text === `${app.path} build: Done`,
        `${app.id} terminal Done`,
      );
      assertCondition(
        start.line < done.line,
        `${app.id} Done precedes its command`,
      );
      const outputLines = [
        ['static-directory', 'Static directory: .output/static'],
        ['node-preview', 'You can preview this build by node .output/index'],
      ].map(([kind, text]) => {
        const output = uniqueLine(
          buildLines,
          item => item.text === `${app.path} build: ${text}`,
          `${app.id} ${kind}`,
        );
        assertCondition(
          start.line < output.line && output.line < done.line,
          `${app.id} Node output lies outside its completed command`,
        );
        return { kind, ...output };
      });
      assertCondition(
        outputLines[0].line < outputLines[1].line,
        `${app.id} Node deploy output is out of order`,
      );
      return {
        appId: app.id,
        command: app.buildScript,
        startLine: start.line,
        completedBy: { kind: 'pnpm-done', ...done },
        outputLines,
      };
    });
  const shellStart = uniqueLine(
    buildLines,
    item => item.text === `$ ${shell.buildScript}`,
    `${shell.id} command`,
  );
  const rootCommands = buildLines.filter(item => item.text.startsWith('$ '));
  assertCondition(
    rootCommands.length === 3 &&
      rootCommands[0].line === shellStart.line &&
      rootCommands[1].text === mfTypesCommand &&
      rootCommands[2].text === performanceCommand,
    'shell must complete before the subsequent root mf-types and performance commands',
  );
  assertCondition(
    commands.every(command => command.completedBy.line < shellStart.line),
    'shell command precedes a vertical completion',
  );
  const shellLines = buildLines.filter(item => item.line > shellStart.line);
  const followingCommands = shellLines.filter(item =>
    item.text.startsWith('$ '),
  );
  assertCondition(
    followingCommands[0]?.text === mfTypesCommand &&
      followingCommands[1]?.text === performanceCommand,
    'shell must complete before the subsequent root mf-types and performance commands',
  );
  const shellOutput = [
    ['static-directory', 'Static directory: .output/static'],
    ['node-preview', 'You can preview this build by node .output/index'],
  ].map(([kind, text]) => {
    const output = uniqueLine(
      shellLines,
      item => item.text === text,
      `${shell.id} ${kind}`,
    );
    assertCondition(
      output.line < followingCommands[0].line,
      'shell Node deploy output follows the subsequent root command',
    );
    return { kind, ...output };
  });
  assertCondition(
    shellOutput[0].line < shellOutput[1].line,
    'shell Node deploy output is out of order',
  );
  commands.push({
    appId: shell.id,
    command: shell.buildScript,
    startLine: shellStart.line,
    completedBy: { kind: 'subsequent-root-command', ...followingCommands[0] },
    outputLines: shellOutput,
  });
  commands.sort((left, right) => left.startLine - right.startLine);
  return {
    applicationSourceRevision,
    projectDirectory,
    commands,
    rootBuild: { command: rootBuildScript, line: rootBuild.line },
  };
}

/** The caller binds project/source to physical outputs; this log has no Git snapshot. */
function parsePriorCloudflareBuildAttribution(
  logText,
  { projectDir, applicationSourceRevision, rootBuildScript, apps } = {},
) {
  assertCondition(
    typeof logText === 'string' &&
      Buffer.byteLength(logText, 'utf8') <= maxLogBytes &&
      !logText.includes('\0'),
    'log must be bounded UTF-8 text',
  );
  assertCondition(
    typeof projectDir === 'string' && path.isAbsolute(projectDir),
    'projectDir must be absolute',
  );
  assertCondition(
    typeof applicationSourceRevision === 'string' &&
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(applicationSourceRevision),
    'applicationSourceRevision must be a full Git revision',
  );
  validateApps(apps, 'cloudflare');
  assertCondition(
    typeof rootBuildScript === 'string' &&
      rootBuildScript.length > 0 &&
      !/[\r\n]/u.test(rootBuildScript),
    'root Cloudflare script is missing or invalid',
  );
  const shell = apps.find(app => app.kind === 'shell');
  const rootStages = rootBuildScript.split(/\s+&&\s+/u);
  const verticalStage = 'pnpm -r --filter "./verticals/*" run cloudflare:build';
  const verticalIndex = rootStages.indexOf(verticalStage);
  assertCondition(
    verticalIndex >= 0 &&
      rootStages.filter(stage => stage === verticalStage).length === 1 &&
      rootStages[verticalIndex + 1] ===
        `pnpm --filter "./${shell.path}" run cloudflare:build` &&
      rootStages[verticalIndex + 2] === 'pnpm mf:types --target cloudflare' &&
      rootStages[verticalIndex + 3] === 'pnpm cloudflare-output:verify' &&
      rootStages[verticalIndex + 4] === 'pnpm cloudflare:ssr-proof' &&
      rootStages.length === verticalIndex + 5,
    'root Cloudflare build must reach the shell through &&',
  );
  const lines = logText.split('\n').map((text, index) => ({
    line: index + 1,
    text: stripVTControlCharacters(text).replace(/\r$/u, ''),
  }));
  const rootBuild = uniqueLine(
    lines,
    item => item.text === `$ ${rootBuildScript}`,
    'root Cloudflare command',
  );
  const shellStart = uniqueLine(
    lines,
    item => item.text === `$ ${shell.buildScript}`,
    `${shell.id} Cloudflare command`,
  );
  assertCondition(
    rootBuild.line < shellStart.line,
    'shell precedes the root Cloudflare command',
  );
  const rootCommands = lines.filter(item => item.text.startsWith('$ '));
  assertCondition(
    rootCommands.length === 2 &&
      rootCommands[0].line === rootBuild.line &&
      rootCommands[1].line === shellStart.line,
    'failed Cloudflare shell cannot reach a subsequent root command',
  );
  const remoteLines = lines.filter(
    item => item.line > rootBuild.line && item.line < shellStart.line,
  );
  const shellLines = lines.filter(item => item.line > shellStart.line);
  const failurePattern =
    /^(?:error(?:\s|:)|failed(?:\s|:|$)|\[?ERR_PNPM_|ELIFECYCLE|Command failed:|Exit status [1-9]|Process exited with code [1-9])/iu;
  for (const item of lines) {
    const prefixed = /^([^\s]+) cloudflare:build(?:\$ |: Done$)/u.exec(
      item.text,
    );
    if (prefixed) {
      assertCondition(
        apps.some(app => app.kind === 'vertical' && app.path === prefixed[1]) &&
          rootBuild.line < item.line &&
          item.line < shellStart.line,
        `unexpected Cloudflare remote command or completion at line ${item.line}`,
      );
    }
  }
  for (const item of remoteLines) {
    const payload = item.text
      .replace(/^[^\s]+ cloudflare:build: /u, '')
      .trimStart();
    assertCondition(
      !failurePattern.test(payload),
      `Cloudflare remote build failed at line ${item.line}`,
    );
  }
  const commands = apps
    .filter(app => app.kind === 'vertical')
    .map(app => {
      const start = uniqueLine(
        remoteLines,
        item => item.text.startsWith(`${app.path} cloudflare:build$ `),
        `${app.id} Cloudflare command`,
      );
      assertCondition(
        start.text === `${app.path} cloudflare:build$ ${app.buildScript}`,
        `${app.id} logged Cloudflare script differs from its manifest`,
      );
      const done = uniqueLine(
        remoteLines,
        item => item.text === `${app.path} cloudflare:build: Done`,
        `${app.id} Cloudflare terminal Done`,
      );
      const verified = uniqueLine(
        remoteLines,
        item =>
          item.text ===
          `${app.path} cloudflare:build: [ultramodern] Cloudflare output verified: ${app.id}`,
        `${app.id} Cloudflare output verification`,
      );
      assertCondition(
        start.line < verified.line && verified.line < done.line,
        `${app.id} Cloudflare verification lies outside its completed command`,
      );
      return {
        appId: app.id,
        command: app.buildScript,
        startLine: start.line,
        completedBy: { kind: 'pnpm-done', ...done },
        outputLines: [{ kind: 'cloudflare-output-verified', ...verified }],
      };
    });
  const failure = uniqueLine(
    shellLines,
    item =>
      /^error\s+Error: \[ultramodern-release-envelope\] UI-only application emitted an undeclared API\/backend artifact\.$/u.test(
        item.text,
      ),
    'shell owning classifier failure',
  );
  for (const item of shellLines.filter(item => item.line < failure.line)) {
    assertCondition(
      !failurePattern.test(item.text.trimStart()),
      `Cloudflare shell failed before the owning classifier at line ${item.line}`,
    );
  }
  const compilerLines = shellLines
    .filter(item => item.line < failure.line)
    .flatMap(item => {
      const environment =
        /^ready\s+built in [0-9]+(?:\.[0-9]+)?s \((server|workerSSR|client)\)$/u.exec(
          item.text,
        )?.[1];
      return environment ? [{ environment, ...item }] : [];
    });
  assertCondition(
    ['server', 'workerSSR', 'client'].every(environment =>
      compilerLines.some(item => item.environment === environment),
    ),
    'failed shell must retain server, workerSSR and client compilation evidence',
  );
  assertCondition(
    !shellLines.some(
      item =>
        item.text === `[ultramodern] Cloudflare output verified: ${shell.id}`,
    ),
    'failed Cloudflare shell cannot claim successful output verification',
  );
  commands.sort((left, right) => left.startLine - right.startLine);
  return {
    applicationSourceRevision,
    projectDirectory: path.resolve(projectDir),
    rootBuild: { command: rootBuildScript, line: rootBuild.line },
    commands,
    shellAttempt: {
      command: shell.buildScript,
      startLine: shellStart.line,
      compilerLines,
      failure,
    },
  };
}

function readPriorBuildAttribution(logPath, options, parser) {
  assertCondition(
    typeof logPath === 'string' && logPath.length > 0,
    'log path is missing',
  );
  const resolved = path.resolve(logPath);
  const stat = fs.lstatSync(resolved, { throwIfNoEntry: false });
  assertCondition(
    stat?.isFile() && !stat.isSymbolicLink(),
    'log must be a regular non-symlink file',
  );
  const fd = fs.openSync(
    resolved,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const opened = fs.fstatSync(fd);
    assertCondition(
      opened.isFile() && opened.size <= maxLogBytes,
      'log file exceeds the size bound',
    );
    // Read at most one byte beyond the observed size, even if another writer
    // grows the file after fstat. Attribute only a complete, stable-sized log.
    const buffer = Buffer.alloc(opened.size + 1);
    let byteLength = 0;
    while (byteLength < buffer.length) {
      const count = fs.readSync(
        fd,
        buffer,
        byteLength,
        buffer.length - byteLength,
        null,
      );
      if (count === 0) break;
      byteLength += count;
    }
    assertCondition(
      byteLength === opened.size && fs.fstatSync(fd).size === opened.size,
      'log file changed while reading',
    );
    const bytes = buffer.subarray(0, byteLength);
    const text = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    return {
      path: resolved,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length,
      text,
      attribution: parser(text, options),
    };
  } finally {
    fs.closeSync(fd);
  }
}

function readPriorNodeBuildAttribution(logPath, options) {
  return readPriorBuildAttribution(
    logPath,
    options,
    parsePriorNodeBuildAttribution,
  );
}

function readPriorCloudflareBuildAttribution(logPath, options) {
  return readPriorBuildAttribution(
    logPath,
    options,
    parsePriorCloudflareBuildAttribution,
  );
}

export {
  parsePriorCloudflareBuildAttribution,
  parsePriorNodeBuildAttribution,
  readPriorCloudflareBuildAttribution,
  readPriorNodeBuildAttribution,
};
