const isDev = process.env.NODE_ENV !== "production";

export const logger = {
  debug: (...args: unknown[]) => {
    if (isDev) console["debug"](...args);
  },
  warn: (...args: unknown[]) => {
    if (isDev) console.warn(...args);
  },
};
