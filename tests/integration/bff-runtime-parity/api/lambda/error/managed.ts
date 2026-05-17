// @effect-diagnostics asyncFunction:off
import { Api, Get } from '@modern-js/plugin-bff/hono-server';
import { HTTPException } from 'hono/http-exception';

export default async () => {
  throw new Error('Intentional managed error in get');
};

export const exceptionManaged = Api(Get('/managed/exception'), async () => {
  throw new HTTPException(401, { message: 'managed exception with 401' });
});
