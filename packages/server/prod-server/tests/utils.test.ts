import { Readable } from 'stream';
import {
  injectServerData,
  injectServerDataStream,
} from '../src/libs/render/utils';

describe('render utils', () => {
  const template = `
    <html>
      <head><title>test</title></head>
      <body><div id="root"></div></body>
    </html>
  `;

  test('should stream inject work correctly', async () => {
    const readable = Readable.from([template]);

    const rtn = injectServerDataStream(readable, {
      serverData: {
        name: 'bytedance',
        headers: {
          authorization: 'secret-token',
          'x-request-id': 'req-1',
        },
      },
    } as any);

    let content = '';
    await new Promise<void>((resolve, reject) => {
      rtn.on('data', chunk => {
        content += chunk.toString();
      });
      rtn.on('end', () => resolve());
      rtn.on('error', reject);
    });

    expect(content).toMatch('"name":"bytedance"');
    expect(content).toMatch('"x-request-id":"req-1"');
    expect(content).not.toMatch('authorization');
  });

  test('should string inject work correctly', () => {
    const rtn = injectServerData(template, {
      serverData: {
        name: 'bytedance',
        headers: {
          cookie: 'sid=hidden',
          'x-request-id': 'req-2',
        },
      },
    } as any);

    expect(rtn).toMatch('"name":"bytedance"');
    expect(rtn).toMatch('"x-request-id":"req-2"');
    expect(rtn).not.toMatch('cookie');
  });
});
