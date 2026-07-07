'use client';

import { useMatch } from '@modern-js/plugin-tanstack/runtime';
import {
  type AnyCompositeComponent,
  CompositeComponent,
} from '@modern-js/plugin-tanstack/runtime/rsc/client';
import type { ReactNode } from 'react';

type CompositeSlots = {
  badge: (label: string) => ReactNode;
  children?: ReactNode;
};

export default function CompositePage() {
  const match = useMatch({ from: '/composite' });
  const card = match.loaderData!.card as AnyCompositeComponent<CompositeSlots>;

  return (
    <main id="composite-page">
      <CompositeComponent
        src={card}
        strict
        badge={(label: string) => (
          <span id="client-slot">client slot:{label}</span>
        )}
      >
        <span id="client-children">client child slot</span>
      </CompositeComponent>
    </main>
  );
}
