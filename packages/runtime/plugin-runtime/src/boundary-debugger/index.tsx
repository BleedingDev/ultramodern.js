import { useEffect, useMemo, useState } from 'react';
import type { RuntimePlugin } from '../core';

export type BoundaryDebugEntry = {
  appId: string;
  color?: string;
  label?: string;
  mfName: string;
  ownerTeam?: string;
  packageName?: string;
  role?: 'host' | 'vertical';
};

export type BoundaryDebugMetadata = {
  appId: string;
  boundaries: BoundaryDebugEntry[];
  schemaVersion: 1;
};

export type BoundaryDebuggerPluginOptions = {
  enabledByDefault?: boolean;
  labels?: Record<string, { toggle: string }>;
  metadata: BoundaryDebugMetadata;
  storageKey?: string;
};

type BoundaryBox = {
  color: string;
  height: number;
  id: string;
  label: string;
  left: number;
  top: number;
  width: number;
};

const defaultStorageKey = 'modernjs:boundary-debugger:enabled';
const defaultLabels: Record<string, { toggle: string }> = {
  cs: { toggle: 'zobrazit hranice verticalů' },
  en: { toggle: 'show vertical boundaries' },
};
const palette = ['#ff5a5f', '#30e27a', '#f6cf45', '#7c8cff', '#29b6f6'];

const readEnabled = (storageKey: string, fallback: boolean) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const stored = window.localStorage.getItem(storageKey);
  return stored === null ? fallback : stored === 'true';
};

const detectLanguage = () => {
  if (typeof document === 'undefined') {
    return 'en';
  }

  const htmlLanguage = document.documentElement.lang;
  if (htmlLanguage) {
    return htmlLanguage.split('-')[0] || 'en';
  }

  return window.location.pathname.split('/').filter(Boolean)[0] || 'en';
};

function BoundaryDebugger({
  enabledByDefault = false,
  labels = defaultLabels,
  metadata,
  storageKey = defaultStorageKey,
}: BoundaryDebuggerPluginOptions) {
  const [mounted, setMounted] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [boxes, setBoxes] = useState<BoundaryBox[]>([]);
  const boundaries = useMemo(
    () =>
      new Map(
        metadata.boundaries.map((entry, index) => [
          entry.mfName,
          {
            ...entry,
            color: entry.color ?? palette[index % palette.length],
            label: entry.label ?? entry.appId,
          },
        ]),
      ),
    [metadata],
  );
  const language = mounted ? detectLanguage() : 'en';
  const toggleLabel =
    labels[language]?.toggle ??
    labels.en?.toggle ??
    defaultLabels.en?.toggle ??
    'show vertical boundaries';

  useEffect(() => {
    setMounted(true);
    setEnabled(readEnabled(storageKey, enabledByDefault));
  }, [enabledByDefault, storageKey]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    window.localStorage.setItem(storageKey, String(enabled));
  }, [enabled, mounted, storageKey]);

  useEffect(() => {
    if (!enabled) {
      setBoxes([]);
      return;
    }

    const readBoxes = () => {
      const nextBoxes = Array.from(
        document.querySelectorAll<HTMLElement>('[data-modern-boundary-id]'),
      )
        .map((element, index) => {
          const boundaryId = element.dataset.modernBoundaryId;
          if (!boundaryId) {
            return undefined;
          }
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            return undefined;
          }
          const boundary = boundaries.get(boundaryId);
          const color = boundary?.color ?? palette[index % palette.length];
          return {
            color,
            height: rect.height,
            id: `${boundaryId}-${index}`,
            label: boundary?.label ?? boundaryId,
            left: rect.left,
            top: rect.top,
            width: rect.width,
          };
        })
        .filter((box): box is BoundaryBox => box !== undefined);
      setBoxes(nextBoxes);
    };

    readBoxes();

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(readBoxes);
    for (const element of document.querySelectorAll<HTMLElement>(
      '[data-modern-boundary-id]',
    )) {
      resizeObserver?.observe(element);
    }

    const mutationObserver = new MutationObserver(readBoxes);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    window.addEventListener('resize', readBoxes);
    window.addEventListener('scroll', readBoxes, true);

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', readBoxes);
      window.removeEventListener('scroll', readBoxes, true);
    };
  }, [boundaries, enabled]);

  if (!mounted) {
    return null;
  }

  return (
    <>
      <label
        style={{
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.96)',
          border: '1px solid rgba(0, 0, 0, 0.1)',
          borderRadius: 12,
          bottom: 20,
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.16)',
          color: '#111827',
          display: 'flex',
          font: '600 14px/1.2 system-ui, sans-serif',
          gap: 8,
          left: 20,
          padding: '12px 14px',
          position: 'fixed',
          zIndex: 2147483000,
        }}
      >
        <input
          checked={enabled}
          onChange={event => setEnabled(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>{toggleLabel}</span>
      </label>
      {enabled ? (
        <div aria-hidden="true">
          {boxes.map(box => (
            <div
              key={box.id}
              style={{
                border: `2px solid ${box.color}`,
                borderRadius: 8,
                boxShadow: `0 0 0 1px rgba(255,255,255,.72), 0 6px 20px color-mix(in srgb, ${box.color} 20%, transparent)`,
                height: box.height,
                left: box.left,
                pointerEvents: 'none',
                position: 'fixed',
                top: box.top,
                width: box.width,
                zIndex: 2147482999,
              }}
            >
              <span
                style={{
                  background: box.color,
                  borderRadius: 999,
                  color: '#111827',
                  font: '800 11px/1 system-ui, sans-serif',
                  padding: '5px 8px',
                  position: 'absolute',
                  right: 4,
                  top: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                {box.label}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

export const ultramodernBoundaryDebuggerPlugin = (
  options: BoundaryDebuggerPluginOptions,
): RuntimePlugin => ({
  name: '@modern-js/runtime/boundary-debugger',
  setup: api => {
    api.wrapRoot(App => {
      return props => (
        <>
          <App {...props} />
          <BoundaryDebugger {...options} />
        </>
      );
    });
  },
});

export default ultramodernBoundaryDebuggerPlugin;
