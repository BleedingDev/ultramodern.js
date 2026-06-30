export type RuntimeMonitors = {
  counter: (name: string, ...args: any[]) => void;
  info: (...args: any[]) => void;
  debug: (...args: any[]) => void;
  trace: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
  timing: (name: string, dur: number, ...args: any[]) => void;
};

export const defaultMonitors: RuntimeMonitors = {
  counter(name: string, ...args: any[]) {},

  info: console.info,
  debug: console.debug,
  trace: console.trace,
  warn: console.warn,
  error: console.error,

  timing(name: string, dur: number, ...args: any[]) {},
};
