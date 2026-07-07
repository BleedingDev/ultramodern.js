import 'server-only';

import { createCompositeComponent } from '@modern-js/plugin-tanstack/runtime/rsc/server';
import type { ReactNode } from 'react';

type CompositeSlots = {
  badge: (label: string) => ReactNode;
  children?: ReactNode;
};

export const loader = async () => {
  const card = await createCompositeComponent<CompositeSlots>(async slots => (
    <section id="rsc-composite">
      <h1>server composite title</h1>
      <p id="server-composite-output">server-rendered composite output</p>
      <div id="slot-host">{slots.badge('slot-label-from-server')}</div>
      <div id="children-host">{slots.children}</div>
    </section>
  ));

  return { card };
};
