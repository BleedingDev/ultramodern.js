// @effect-diagnostics asyncFunction:off globalTimers:off newPromise:off strictBooleanExpressions:off
import effectBff from '@api/effect/index';
import { useEffect, useState } from 'react';

type TraceViewModel = {
  status: string;
  traceId: string;
  rootSpanId: string;
  runSpanId: string;
  runParentSpanId: string;
  runTraceId: string;
  dbParentSpanId: string;
  dbTraceId: string;
  spanNames: string;
};

function randomHex(bytes: number) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, part => part.toString(16).padStart(2, '0')).join('');
}

function createTraceparent() {
  const traceId = randomHex(16);
  const rootSpanId = randomHex(8);
  return {
    traceId,
    rootSpanId,
    traceparent: `00-${traceId}-${rootSpanId}-01`,
  };
}

export default function TracePage() {
  const [model, setModel] = useState<TraceViewModel>({
    status: 'pending',
    traceId: '',
    rootSpanId: '',
    runSpanId: '',
    runParentSpanId: '',
    runTraceId: '',
    dbParentSpanId: '',
    dbTraceId: '',
    spanNames: '',
  });

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      const { traceId, rootSpanId, traceparent } = createTraceparent();
      await effectBff.client.greetings.traceReset({});
      await effectBff.client.greetings.traceRun({
        headers: {
          traceparent,
        },
      });

      for (let attempt = 0; attempt < 20; attempt++) {
        const { spans } = await effectBff.client.greetings.traceSpans({
          query: { traceId },
        });
        const runSpan = spans.find(
          span => span.name === 'bff.effect.trace.run',
        );
        const dbSpan = spans.find(span => span.name === 'bff.effect.db.query');

        if (runSpan && dbSpan) {
          if (!mounted) {
            return;
          }
          setModel({
            status: 'ok',
            traceId,
            rootSpanId,
            runSpanId: runSpan.spanId,
            runParentSpanId: runSpan.parentSpanId ?? '',
            runTraceId: runSpan.traceId,
            dbParentSpanId: dbSpan.parentSpanId ?? '',
            dbTraceId: dbSpan.traceId,
            spanNames: spans
              .map(span => span.name)
              .sort()
              .join(','),
          });
          return;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (mounted) {
        setModel(current => ({
          ...current,
          status: 'missing-spans',
          traceId,
          rootSpanId,
        }));
      }
    };

    run().catch(error => {
      if (!mounted) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setModel(current => ({
        ...current,
        status: `error:${message}`,
      }));
    });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div>
      <div className="trace-status">{model.status}</div>
      <div className="trace-id">{model.traceId}</div>
      <div className="trace-root-span-id">{model.rootSpanId}</div>
      <div className="trace-run-span-id">{model.runSpanId}</div>
      <div className="trace-run-parent-span-id">{model.runParentSpanId}</div>
      <div className="trace-run-trace-id">{model.runTraceId}</div>
      <div className="trace-db-parent-span-id">{model.dbParentSpanId}</div>
      <div className="trace-db-trace-id">{model.dbTraceId}</div>
      <div className="trace-span-names">{model.spanNames}</div>
    </div>
  );
}
