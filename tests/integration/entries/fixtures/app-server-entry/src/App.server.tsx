import { RuntimeContext } from '@modern-js/runtime';
import {
  createStaticRouter,
  type StaticHandlerContext,
  StaticRouterProvider,
} from '@modern-js/runtime-utils/router';
import { use } from 'react';
import { routes } from './routes';

const App = () => {
  const { customRouterContext } = use(RuntimeContext);
  const router = createStaticRouter(
    routes,
    customRouterContext as StaticHandlerContext,
  );
  return (
    <StaticRouterProvider
      router={router}
      context={customRouterContext as StaticHandlerContext}
    />
  );
};

export default App;
