type DebugLogger = ((...args: unknown[]) => void) & {
  extend: () => DebugLogger;
};

export default function createDebug(_namespace: string): DebugLogger {
  const logger = ((..._args: unknown[]) => undefined) as DebugLogger;
  logger.extend = () => logger;
  return logger;
}
