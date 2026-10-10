// The tracer is injected by Single Step Instrumentation (k8s/agent/datadog-agent.yaml)
// and configured through DD_* env vars. dd-trace is deliberately NOT a dependency:
// SSI backs off when an app bundles its own copy. We reach the injected tracer
// through the global it registers, and fall back to a no-op (unit tests, local runs).

interface Span {
  setTag(key: string, value: unknown): void;
  context(): { toTraceId(): string };
}

interface Tracer {
  scope(): { active(): Span | null };
  // Sets usr.* on the root (request) span, which is also what AAP keys users on.
  setUser(user: { id: string; [key: string]: string }): void;
  dogstatsd: { increment(name: string, value?: number, tags?: Record<string, string>): void };
}

const noop: Tracer = {
  scope: () => ({ active: () => null }),
  setUser: () => undefined,
  dogstatsd: { increment: () => undefined },
};

const injected = () => (globalThis as { _ddtrace?: Tracer })._ddtrace ?? noop;

const tracer: Tracer = {
  scope: () => injected().scope(),
  setUser: (user) => injected().setUser(user),
  dogstatsd: {
    increment: (...args) => injected().dogstatsd.increment(...args),
  },
};

export default tracer;
