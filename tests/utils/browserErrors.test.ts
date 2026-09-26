import http from 'node:http';
import type { AddressInfo } from 'node:net';
import puppeteer, { type Browser } from 'puppeteer';
import { collectBrowserErrors } from './browserErrors';
import { launchOptions } from './launchOptions';

// Mirrors React's owner stacks: the error is logged inside a console.createTask
// run, so only the async parent names the component that caused it.
const EMITTER_SOURCE = `function createOwnerTask() {
  return console.createTask('<SSRLiveReload>');
}
const ownerTask = createOwnerTask();
ownerTask.run(function validateHostElement() {
  console.error('Encountered a script tag', 42);
});
setTimeout(function throwUncaught() {
  throw new Error('thrown by the fixture');
});
`;

let browser: Browser;
let server: http.Server;
let origin: string;

beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/emitter.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(EMITTER_SOURCE);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><script src="/emitter.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await puppeteer.launch(launchOptions as any);
});

afterAll(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
});

test('collected browser errors name the emitting stack and its owner task', async () => {
  const page = await browser.newPage();
  const errors: string[] = [];
  await collectBrowserErrors(page, errors);

  await page.goto(`${origin}/`, { waitUntil: 'load' });
  // The uncaught error is queued before this task, so it has fired afterwards.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve)));
  await page.close();

  expect(errors).toHaveLength(2);
  expect(errors[0]).toBe(
    [
      'Encountered a script tag 42',
      `    at validateHostElement (${origin}/emitter.js:6:11)`,
      `    at ${origin}/emitter.js:5:11`,
      '    --- <SSRLiveReload> ---',
      `    at createOwnerTask (${origin}/emitter.js:2:18)`,
      `    at ${origin}/emitter.js:4:19`,
    ].join('\n'),
  );
  expect(errors[1]).toContain('Error: thrown by the fixture');
  expect(errors[1]).toContain(`${origin}/emitter.js:9:9`);
});
