import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { hydrationScript, renderApp } from './dist/server/index.js';

const files = await readdir('dist/client/static/js');
const lazy = files.find(x => x.startsWith('lazy.')),
  entry = files.find(x => x.startsWith('index.'));
const manifest = {
  _base: '/',
  '__SOLID_LAZY_MODULE__:./Lazy': {
    file: 'static/js/' + lazy,
    css: [],
    imports: [],
  },
};
createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/static/')) {
      res.setHeader('content-type', 'application/javascript');
      res.end(await readFile(join('dist/client', req.url)));
      return;
    }
    const html = await renderApp(manifest, req.url);
    res.setHeader('content-type', 'text/html');
    res.end(
      '<!doctype html><html><head>' +
        hydrationScript() +
        '</head><body><div id="root">' +
        html +
        '</div><script type="module" src="/static/js/' +
        entry +
        '"></script></body></html>',
    );
  } catch (e) {
    res.statusCode = 500;
    res.end(e.stack);
  }
}).listen(4194, () => console.log('Solid admission hydration host 4194'));
