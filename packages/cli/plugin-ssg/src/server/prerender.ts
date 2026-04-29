import type { NodeRequest, NodeResponse } from '@modern-js/types';
import EventEmitter from 'events';
import httpMocks from 'node-mocks-http';
import { Readable } from 'stream';

export type Options = {
  url: string;
  headers: {
    host: string;
    [key: string]: string;
  };
  [propName: string]: any;
};

type MockHttpResponse = ReturnType<typeof httpMocks.createResponse> & {
  on: (event: 'finish' | 'error', listener: (...args: any[]) => void) => void;
  statusCode: number;
  statusMessage?: string;
  _getData: () => string;
};

export const compile =
  (requestHandler: (req: NodeRequest, res: NodeResponse) => void) =>
  (options: Options, extend = {}): Promise<string> =>
    new Promise((resolve, reject) => {
      const req = httpMocks.createRequest({
        ...options,
        eventEmitter: Readable,
      });
      const res = httpMocks.createResponse({
        eventEmitter: EventEmitter,
      }) as MockHttpResponse;

      Object.assign(req, extend);
      const proxyRes = new Proxy(res, {
        get(obj: any, prop: any) {
          if (typeof prop === 'symbol' && !obj[prop]) {
            return null;
          }
          return obj[prop];
        },
      });

      res.on('finish', () => {
        if (res.statusCode !== 200) {
          reject(new Error(res.statusMessage || 'Prerender failed'));
        } else {
          resolve(res._getData());
        }
      });

      res.on('error', (e: Error) => reject(e));
      try {
        requestHandler(req, proxyRes);
      } catch (e) {
        reject(e);
      }
    });
