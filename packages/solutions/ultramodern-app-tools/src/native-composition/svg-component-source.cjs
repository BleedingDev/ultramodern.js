const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(value) {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/giu,
    (_match, decimal, hex, named) =>
      named
        ? entities[named.toLowerCase()]
        : String.fromCodePoint(
            Number.parseInt(decimal ?? hex, decimal ? 10 : 16),
          ),
  );
}

const ignorable =
  /<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>/giu;

/**
 * Split one SVG document into its root attributes and inner markup. Inner
 * markup stays verbatim: renderers insert it as trusted HTML in SVG context.
 */
function parseSvgDocument(source, filename) {
  const text = String(source).replace(/^﻿/u, '');
  const start = text.search(/<svg[\s/>]/iu);
  if (start < 0 || text.slice(0, start).replace(ignorable, '').trim())
    throw new Error(`${filename} must contain one <svg> root element`);
  const attributes = {};
  const attribute =
    /\s*([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/uy;
  let index = start + 4;
  let selfClosing = false;
  for (;;) {
    while (/\s/u.test(text[index] ?? '')) index++;
    if (text[index] === '>') {
      index++;
      break;
    }
    if (text.startsWith('/>', index)) {
      index += 2;
      selfClosing = true;
      break;
    }
    attribute.lastIndex = index;
    const match = attribute.exec(text);
    if (!match || match[0].length === 0)
      throw new Error(`${filename} has a malformed <svg> start tag`);
    index = attribute.lastIndex;
    const name = match[1];
    // The DOM owns the SVG namespace; xmlns attributes are not properties.
    if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
    attributes[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  let markup = '';
  let end = index;
  if (!selfClosing) {
    const close = text.toLowerCase().lastIndexOf('</svg>');
    if (close < index) throw new Error(`${filename} has no closing </svg> tag`);
    markup = text.slice(index, close).trim();
    end = close + '</svg>'.length;
  }
  if (text.slice(end).replace(ignorable, '').trim())
    throw new Error(`${filename} has content after its <svg> root element`);
  return { attributes, markup };
}

/**
 * Write the generated component beside the native entry sources so the
 * selected renderer compiles it with its ordinary application pipeline.
 */
function writeSvgComponentModule(options) {
  const { resourcePath, outputDirectory, source } = options;
  const stem = path
    .basename(resourcePath, path.extname(resourcePath))
    .replace(/[^\w-]+/gu, '_');
  const digest = createHash('sha256')
    .update(path.resolve(resourcePath))
    .digest('hex')
    .slice(0, 16);
  const file = path.join(outputDirectory, `${stem}-${digest}.tsx`);
  let current;
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (current !== source) {
    fs.mkdirSync(outputDirectory, { recursive: true });
    // Client and server compilers may write the same module concurrently.
    const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(temporary, source);
    fs.renameSync(temporary, file);
  }
  return file;
}

/**
 * Generate a `?component` SVG module from the selected renderer's template,
 * a CommonJS module exporting `({ attributes, markup, origin }) => source`.
 */
function svgComponentLoader(source) {
  // The emitted module points at a generated file; always regenerate it.
  this.cacheable(false);
  const { outputDirectory, template } = this.getOptions();
  const render = require(template);
  const { attributes, markup } = parseSvgDocument(source, this.resourcePath);
  const file = writeSvgComponentModule({
    resourcePath: this.resourcePath,
    outputDirectory,
    source: render({
      attributes: JSON.stringify(attributes, null, 2),
      markup: JSON.stringify(markup),
      origin: path.relative(
        this.rootContext ?? process.cwd(),
        this.resourcePath,
      ),
    }),
  });
  return `export { default } from ${JSON.stringify(file)};\n`;
}

module.exports = {
  svgComponentLoader,
  parseSvgDocument,
  writeSvgComponentModule,
};
