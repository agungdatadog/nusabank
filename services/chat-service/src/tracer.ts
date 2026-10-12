// The tracer is injected by Single Step Instrumentation (k8s/agent/datadog-agent.yaml)
// and configured through DD_* env vars. dd-trace is deliberately NOT a dependency:
// SSI backs off when an app bundles its own copy. We reach the injected tracer
// through the global it registers, and fall back to a no-op (unit tests, local runs).

export interface Span {
  setTag(key: string, value: unknown): void;
  context(): { toTraceId(): string };
}

export interface SpanContext {
  toTraceId(): string;
}

type Tags = Record<string, string>;

interface Tracer {
  scope(): { active(): Span | null };
  // Sets usr.* on the root (request) span, which is also what AAP keys users on.
  setUser(user: { id: string; [key: string]: string }): void;
  trace<T>(name: string, options: { resource?: string; childOf?: SpanContext | null; tags?: Record<string, unknown> }, fn: (span: Span) => T): T;
  inject(span: Span, format: "text_map", carrier: Record<string, string>): void;
  extract(format: "text_map", carrier: Record<string, string>): SpanContext | null;
  dogstatsd: {
    increment(name: string, value?: number, tags?: Tags): void;
    distribution(name: string, value: number, tags?: Tags): void;
  };
}

const noopSpan: Span = { setTag: () => undefined, context: () => ({ toTraceId: () => "" }) };

const noop: Tracer = {
  scope: () => ({ active: () => null }),
  setUser: () => undefined,
  trace: (_name, _options, fn) => fn(noopSpan),
  inject: () => undefined,
  extract: () => null,
  dogstatsd: { increment: () => undefined, distribution: () => undefined },
};

const injected = () => (globalThis as { _ddtrace?: Tracer })._ddtrace ?? noop;

const tracer: Tracer = {
  scope: () => injected().scope(),
  setUser: (user) => injected().setUser(user),
  trace: (name, options, fn) => injected().trace(name, options, fn),
  inject: (span, format, carrier) => injected().inject(span, format, carrier),
  extract: (format, carrier) => injected().extract(format, carrier),
  dogstatsd: {
    increment: (...args) => injected().dogstatsd.increment(...args),
    distribution: (...args) => injected().dogstatsd.distribution(...args),
  },
};

// Tags the active span; used for business context (biller, category, partner).
export function tag(tags: Record<string, unknown>): void {
  const span = tracer.scope().active();
  if (!span) return;
  for (const [k, v] of Object.entries(tags)) if (v !== undefined) span.setTag(k, v);
}

export default tracer;
