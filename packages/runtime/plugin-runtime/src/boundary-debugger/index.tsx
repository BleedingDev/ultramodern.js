import type { ComponentType } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { RuntimePlugin } from '../common';

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

export type BoundaryDebuggerControlMode =
  | 'visible'
  | 'hidden-when-off'
  | 'hidden';

export type BoundaryDebuggerPluginOptions = {
  controlMode?: BoundaryDebuggerControlMode;
  enabledByDefault?: boolean;
  labels?: Record<string, { toggle: string }>;
  legacySelector?: string;
  metadata: BoundaryDebugMetadata;
  storageKey?: string;
};

type BoundaryBox = {
  color: string;
  detail?: string;
  height: number;
  id: string;
  label: string;
  left: number;
  top: number;
  width: number;
};

const defaultStorageKey = 'modernjs:boundary-debugger:enabled';
const queryParamName = 'modern-boundaries';
const boundarySelector = '[data-modern-boundary-id]';
const defaultLabels: Record<string, { toggle: string }> = {
  cs: { toggle: 'zobrazit hranice týmů' },
  en: { toggle: 'show team boundaries' },
};
const palette = ['#ff5a5f', '#30e27a', '#f6cf45', '#7c8cff', '#29b6f6'];

const readStoredEnabled = (storageKey: string, fallback: boolean) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored === null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
};

const writeStoredEnabled = (storageKey: string, enabled: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, String(enabled));
  } catch {
    // Storage may be blocked in private, embedded, or policy-restricted contexts.
  }
};

const parseEnabledOverride = (value: string | null) => {
  if (value === null) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (normalized === '1' || normalized === 'true') {
    return true;
  }
  if (normalized === '0' || normalized === 'false') {
    return false;
  }

  return undefined;
};

const readQueryEnabledOverride = () => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return parseEnabledOverride(
      new URLSearchParams(window.location.search).get(queryParamName),
    );
  } catch {
    return undefined;
  }
};

const detectLanguage = () => {
  if (typeof document === 'undefined') {
    return 'en';
  }

  const htmlLanguage = document.documentElement.lang;
  if (htmlLanguage !== '') {
    return htmlLanguage.split('-')[0] || 'en';
  }

  if (typeof window === 'undefined') {
    return 'en';
  }

  return window.location.pathname.split('/').filter(Boolean)[0] || 'en';
};

const hashBoundaryId = (id: string) => {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const formatRectKey = (rect: DOMRect) =>
  [
    Math.round(rect.left * 100) / 100,
    Math.round(rect.top * 100) / 100,
    Math.round(rect.width * 100) / 100,
    Math.round(rect.height * 100) / 100,
  ].join(':');

const getBoundaryId = (element: HTMLElement) =>
  element.dataset.modernBoundaryId ??
  element.dataset.mfRemote ??
  element.getAttribute('data-mf-remote') ??
  undefined;

const collectBoundaryElements = (legacySelector?: string) => {
  const elements = new Set<HTMLElement>();
  for (const element of document.querySelectorAll<HTMLElement>(
    boundarySelector,
  )) {
    elements.add(element);
  }

  if (legacySelector === undefined || legacySelector === '') {
    return Array.from(elements);
  }

  try {
    for (const element of document.querySelectorAll<HTMLElement>(
      legacySelector,
    )) {
      elements.add(element);
    }
  } catch {
    // Ignore invalid optional legacy selectors; the standard selector still works.
  }

  return Array.from(elements);
};

function BoundaryDebugger({
  controlMode = 'visible',
  enabledByDefault = false,
  labels = defaultLabels,
  legacySelector,
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
    'show team boundaries';

  useEffect(() => {
    setMounted(true);
    const queryOverride = readQueryEnabledOverride();
    setEnabled(
      queryOverride ?? readStoredEnabled(storageKey, enabledByDefault),
    );
  }, [enabledByDefault, storageKey]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    writeStoredEnabled(storageKey, enabled);
  }, [enabled, mounted, storageKey]);

  useEffect(() => {
    if (!enabled) {
      setBoxes([]);
      return;
    }

    let resizeObserver: ResizeObserver | undefined;
    const observedElements = new Set<HTMLElement>();
    const observeBoundaryElements = (elements: HTMLElement[]) => {
      if (resizeObserver === undefined) {
        return;
      }
      for (const element of elements) {
        if (observedElements.has(element)) {
          continue;
        }
        observedElements.add(element);
        resizeObserver.observe(element);
      }
    };

    const readBoxes = () => {
      const elements = collectBoundaryElements(legacySelector);
      observeBoundaryElements(elements);
      const seenBoxes = new Set<string>();
      const nextBoxes = elements
        .map((element): BoundaryBox | undefined => {
          const boundaryId = getBoundaryId(element);
          if (boundaryId === undefined || boundaryId === '') {
            return undefined;
          }
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            return undefined;
          }
          const rectKey = formatRectKey(rect);
          const boxKey = `${boundaryId}:${rectKey}`;
          if (seenBoxes.has(boxKey)) {
            return undefined;
          }
          seenBoxes.add(boxKey);
          const boundary = boundaries.get(boundaryId);
          const color =
            boundary?.color ??
            palette[hashBoundaryId(boundaryId) % palette.length];
          const label = boundary?.label ?? boundary?.appId ?? boundaryId;
          const expose = element.dataset.modernMfExpose;
          const detail =
            expose !== undefined &&
            expose !== '' &&
            expose !== label &&
            expose !== boundaryId
              ? expose
              : undefined;
          const box: BoundaryBox = {
            color,
            height: rect.height,
            id: boxKey,
            label,
            left: rect.left,
            top: rect.top,
            width: rect.width,
          };
          if (detail !== undefined) {
            box.detail = detail;
          }
          return box;
        })
        .filter((box): box is BoundaryBox => box !== undefined);
      setBoxes(nextBoxes);
    };

    resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(readBoxes);
    readBoxes();

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
  }, [boundaries, enabled, legacySelector]);

  if (!mounted) {
    return null;
  }

  const shouldRenderToggle =
    controlMode === 'visible' || (controlMode === 'hidden-when-off' && enabled);

  return (
    <>
      {shouldRenderToggle ? (
        <label
          style={{
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.96)',
            border: '1px solid rgba(0, 0, 0, 0.1)',
            borderRadius: 10,
            boxShadow: '0 10px 28px rgba(0, 0, 0, 0.14)',
            color: '#111827',
            display: 'flex',
            font: '600 13px/1.2 system-ui, sans-serif',
            gap: 8,
            left: 'max(12px, env(safe-area-inset-left))',
            maxWidth: 'calc(100vw - 24px)',
            padding: '9px 11px',
            position: 'fixed',
            top: 'max(12px, env(safe-area-inset-top))',
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
      ) : null}
      {enabled ? (
        <div aria-hidden="true">
          {boxes.map(box => (
            <div
              key={box.id}
              data-modern-boundary-overlay=""
              data-modern-boundary-overlay-id={box.id}
              data-modern-boundary-overlay-label={box.label}
              style={{
                border: `2px solid ${box.color}`,
                borderRadius: 8,
                boxSizing: 'border-box',
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
                  display: 'grid',
                  font: '800 11px/1.1 system-ui, sans-serif',
                  gap: 3,
                  maxWidth: 'min(280px, calc(100vw - 24px))',
                  padding: '5px 8px',
                  position: 'absolute',
                  right: 4,
                  top: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{box.label}</span>
                {box.detail !== undefined && box.detail !== '' ? (
                  <span
                    style={{
                      font: '700 10px/1.1 system-ui, sans-serif',
                      opacity: 0.82,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {box.detail}
                  </span>
                ) : null}
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
    api.wrapRoot((App: ComponentType<any>) => (props: any) => (
      <>
        <App {...props} />
        <BoundaryDebugger {...options} />
      </>
    ));
  },
});

export default ultramodernBoundaryDebuggerPlugin;
