'use client';

import { useActionState } from 'react';
import { incrementByForm } from './action';

export function ActionForm() {
  const [result, formAction, isPending] = useActionState(incrementByForm, 0);

  return (
    <section id="server-action">
      <h2>Native server action</h2>
      <output id="action-result" className="server-count">
        {result}
      </output>
      <form id="action-form" action={formAction}>
        <label htmlFor="action-count">Count</label>
        <input id="action-count" name="count" type="number" defaultValue="3" />
        <button className="server-increment" type="submit" disabled={isPending}>
          {isPending ? 'Loading...' : 'Increment'}
        </button>
      </form>
    </section>
  );
}
