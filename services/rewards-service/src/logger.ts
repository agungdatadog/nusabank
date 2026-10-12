import pino from "pino";

// JSON to stdout; dd-trace's logInjection adds dd.trace_id / dd.span_id per line.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  messageKey: "message",
  formatters: { level: (label) => ({ level: label }) },
  timestamp: pino.stdTimeFunctions.isoTime,
});
