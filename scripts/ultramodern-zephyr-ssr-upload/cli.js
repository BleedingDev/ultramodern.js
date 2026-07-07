const { parseCliArgs } = require('../lib/cli-kit');

const { DEFAULT_EVIDENCE_FILE } = require('./constants');

const { uploadCloudflareSsrToZephyr } = require('./zephyr-upload');

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/ultramodern-zephyr-ssr-upload/upload-zephyr-ssr.js [options]

Options:
  --root-dir <path>     Workspace or app root. Defaults to the current directory.
  --output-dir <path>   Modern Cloudflare output directory. Defaults to .output.
  --public-dir <path>   Public assets directory. Defaults to wrangler assets.directory.
  --base-url <path>     Public base URL passed to zephyr-agent. Defaults to /.
  --out <path>          Evidence JSON path. Defaults to .output/${DEFAULT_EVIDENCE_FILE}.
  --help                Show this help.
`);
}

function parseArgs(argv) {
  return parseCliArgs(argv, {
    defaults: {},
    options: {
      help: {
        type: 'boolean',
        short: 'h',
      },
      'root-dir': {
        key: 'rootDir',
      },
      'output-dir': {
        key: 'outputDir',
      },
      'public-dir': {
        key: 'publicDir',
      },
      'base-url': {
        key: 'baseURL',
      },
      out: {
        key: 'evidencePath',
      },
    },
  });
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return;
  }

  const evidence = await uploadCloudflareSsrToZephyr(args);
  process.stdout.write(
    `[zephyr-ssr-upload] uploaded ${evidence.upload.entrypoint} to ${evidence.deployment.deploymentUrl ?? 'Zephyr'}\n`,
  );
  process.stdout.write(
    `[zephyr-ssr-upload] evidence written to ${evidence.evidencePath}\n`,
  );
}

module.exports = {
  main,
  parseArgs,
  printUsage,
};
