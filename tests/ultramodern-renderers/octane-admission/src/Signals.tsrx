import { Hydrate } from "octane";
import { interaction } from "octane/hydration";
import { query$ } from "octane/signals";

export function Signals({ url }: { url: string }) @{
  const message$ = query$(
    () => url,
    async function* (requestUrl, { signal }) {
      yield await fetch(requestUrl, { signal }).then((response) => response.text());
      yield "Native signal complete";
    },
    { kind: "stream" },
  );
  <Hydrate when={interaction({ events: "click" })}>
    @try {
      <button data-testid="signal-value">{message$.get() as string}</button>;
    } @pending {
      <button data-testid="signal-pending">Loading native signal</button>;
    } @catch {
      <p data-testid="signal-error">Native signal failed</p>;
    }
  </Hydrate>;
}
