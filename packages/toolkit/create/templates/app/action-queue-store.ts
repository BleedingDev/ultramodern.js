import { useEffect, useMemo, useState } from 'react';

export type ActionLine = {
  id: string;
  nameKey: string;
  status: 'queued' | 'complete';
};

const storageKey = 'ultramodern-action-queue';
const queueEvent = 'ultramodern-action-queue-change';
const starterAction: ActionLine = {
  id: 'starter-action',
  nameKey: 'actions.queue.starterAction',
  status: 'queued',
};

const readQueue = (): ActionLine[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const value = window.localStorage.getItem(storageKey);
    return value ? (JSON.parse(value) as ActionLine[]) : [];
  } catch {
    return [];
  }
};

const writeQueue = (lines: ActionLine[]) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(lines));
  window.dispatchEvent(new CustomEvent(queueEvent));
};

const updateLine = (
  id: string,
  updater: (line: ActionLine) => ActionLine | undefined,
) => {
  const next = readQueue()
    .map(line => (line.id === id ? updater(line) : line))
    .filter((line): line is ActionLine => Boolean(line));
  writeQueue(next);
};

export function useActionQueue() {
  const [lines, setLines] = useState<ActionLine[]>(() => readQueue());

  useEffect(() => {
    const refresh = () => setLines(readQueue());
    window.addEventListener(queueEvent, refresh);
    window.addEventListener('storage', refresh);
    refresh();

    return () => {
      window.removeEventListener(queueEvent, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return useMemo(
    () => ({
      lines,
      addStarterAction: () => {
        const existing = readQueue();
        const match = existing.find(line => line.id === starterAction.id);
        writeQueue(
          match
            ? existing.map(line =>
                line.id === starterAction.id
                  ? { ...line, status: 'queued' as const }
                  : line,
              )
            : [...existing, starterAction],
        );
      },
      complete: (id: string) =>
        updateLine(id, line => ({ ...line, status: 'complete' as const })),
      remove: (id: string) => writeQueue(readQueue().filter(line => line.id !== id)),
    }),
    [lines],
  );
}
