import { routerPlugin } from '../../../src/router/runtime/plugin';

Reflect.set(globalThis, '__MODERN_ROUTER_BUILD_BOUNDARY__', routerPlugin());
