const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { reservePort, waitForHttp } = require('../process-kit');

test('reservePort returns an available TCP port', async () => {
  const port = await reservePort();
  assert.equal(Number.isInteger(port), true);
  assert.equal(port > 0, true);
});

test('waitForHttp accepts caller-provided readiness predicates', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(418);
    response.end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const result = await waitForHttp(`http://127.0.0.1:${port}`, {
      expectedStatus: status => status === 418,
      intervalMs: 10,
      timeoutMs: 500,
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 418);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
