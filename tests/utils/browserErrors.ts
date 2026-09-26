import type { Page, Protocol } from 'puppeteer';

// Enough async frames to reach the component that created the offending JSX
// through React's console.createTask owner stacks.
const ASYNC_STACK_DEPTH = 32;

function formatFrame(frame: Protocol.Runtime.CallFrame) {
  // CDP reports 0-based positions; print 1-based so the frame opens in editors.
  const location = `${frame.url || '<anonymous>'}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
  return frame.functionName
    ? `    at ${frame.functionName} (${location})`
    : `    at ${location}`;
}

function formatStackTrace(stackTrace: Protocol.Runtime.StackTrace | undefined) {
  const lines: string[] = [];
  for (let trace = stackTrace; trace; trace = trace.parent) {
    if (trace !== stackTrace) {
      lines.push(`    --- ${trace.description || 'async'} ---`);
    }
    lines.push(...trace.callFrames.map(formatFrame));
  }
  return lines;
}

function formatArgument(argument: Protocol.Runtime.RemoteObject) {
  if (argument.unserializableValue) {
    return argument.unserializableValue;
  }
  if (argument.value !== undefined) {
    return String(argument.value);
  }
  return argument.description ?? argument.type;
}

/**
 * Formats a `console.error` call with the stack that emitted it, including the
 * async parents (React owner stacks), so a failing `expect(errors).toEqual([])`
 * names the emitter instead of only its text.
 */
export function formatConsoleError(
  event: Protocol.Runtime.ConsoleAPICalledEvent,
) {
  return [
    event.args.map(formatArgument).join(' '),
    ...formatStackTrace(event.stackTrace),
  ].join('\n');
}

/**
 * Records every `console.error` (with its emitting stack and async parents)
 * and every uncaught page error (with its stack) into `errors`.
 */
export async function collectBrowserErrors(page: Page, errors: string[]) {
  const session = await page.createCDPSession();
  session.on('Runtime.consoleAPICalled', event => {
    if (event.type === 'error') {
      errors.push(formatConsoleError(event));
    }
  });
  page.on('pageerror', error => {
    errors.push(
      error instanceof Error ? error.stack || error.message : String(error),
    );
  });
  await session.send('Runtime.enable');
  await session.send('Debugger.enable');
  // Async stacks need the debugger agent, but page code must never pause.
  await session.send('Debugger.setSkipAllPauses', { skip: true });
  await session.send('Debugger.setAsyncCallStackDepth', {
    maxDepth: ASYNC_STACK_DEPTH,
  });
}
