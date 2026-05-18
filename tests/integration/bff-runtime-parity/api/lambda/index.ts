// @effect-diagnostics asyncFunction:off
import {
  Api,
  Data,
  Get,
  Headers,
  Middleware,
  Params,
  Pipe,
  Post,
  Query,
} from '@modern-js/plugin-bff/hono-server';
import { useHonoContext } from '@modern-js/server-runtime';
import { z } from 'zod';

export default async () => ({
  message: 'Hello Modern.js',
});

const QuerySchema = z.object({
  user: z.string().email(),
  ext: z.array(
    z.object({
      from: z.string(),
    }),
  ),
  arr: z.array(z.string()),
  obj: z.object({
    a: z.string(),
  }),
});

const DataSchema = z.object({
  message: z.string(),
});

const ParamsSchema = z.object({
  id: z.string(),
});

const HeadersSchema = z.object({
  'x-header': z.string(),
});

type PostHelloInput = {
  params: z.infer<typeof ParamsSchema>;
  query: z.infer<typeof QuerySchema>;
  data: z.infer<typeof DataSchema>;
  headers: z.infer<typeof HeadersSchema>;
};

export const postHello = Api(
  Post('/hello/:id'),
  Params(ParamsSchema),
  Query(QuerySchema),
  Data(DataSchema),
  Headers(HeadersSchema),
  Middleware(async (c, next) => {
    c.res.headers.set('x-bff-fn-middleware', '1');
    await next();
  }),
  Pipe<PostHelloInput>(input => {
    const { data } = input;
    if (!data.message.startsWith('msg: ')) {
      data.message = `msg: ${data.message}`;
    }
    return input;
  }),
  async ({ query, data, params, headers }) => {
    const c = useHonoContext();
    c.res.headers.set('x-bff-api', c.req.path);
    return {
      path: c.req.path,
      params,
      query,
      data,
      headers,
    };
  },
);

const GetQuerySchema = z.object({
  user: z.string().email(),
});

export const getHello = Api(
  Get('/hello/get'),
  Query(GetQuerySchema),
  async ({ query }) => {
    const c = useHonoContext();
    c.res.headers.set('x-bff-api', c.req.path);
    return {
      query,
    };
  },
);

export const getImage = Api(Get('/hello/image'), async () => {
  const validBase64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
  const base64Data = validBase64.split(',')[1]!;
  const binary = Buffer.from(base64Data, 'base64');

  return new Response(binary, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'no-store',
    },
  });
});
