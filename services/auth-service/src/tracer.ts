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
  // AAP account-takeover events: login success/failure feed the credential-stuffing detections.
  appsec?: {
    eventTrackingV2?: {
      trackUserLoginSuccess(login: string, user?: { id: string }): void;
      trackUserLoginFailure(login: string, exists: boolean): void;
    };
    trackUserLoginSuccessEvent?(user: { id: string }): void;
    trackUserLoginFailureEvent?(userId: string, exists: boolean): void;
  };
}

const noop: Tracer = {
  scope: () => ({ active: () => null }),
  setUser: () => undefined,
  dogstatsd: { increment: () => undefined },
};

const injected = () => (globalThis as { _ddtrace?: Tracer })._ddtrace ?? noop;

const tracer = {
  scope: () => injected().scope(),
  setUser: (user: { id: string; [key: string]: string }) => injected().setUser(user),
  dogstatsd: {
    increment: (...args: Parameters<Tracer["dogstatsd"]["increment"]>) => injected().dogstatsd.increment(...args),
  },
  // Prefers the v2 API (keyed on the login name); older injected tracers only have the v1 calls.
  loginSuccess(login: string, userId: string) {
    const a = injected().appsec;
    if (a?.eventTrackingV2) a.eventTrackingV2.trackUserLoginSuccess(login, { id: userId });
    else a?.trackUserLoginSuccessEvent?.({ id: userId });
  },
  loginFailure(login: string, exists: boolean) {
    const a = injected().appsec;
    if (a?.eventTrackingV2) a.eventTrackingV2.trackUserLoginFailure(login, exists);
    else a?.trackUserLoginFailureEvent?.(login, exists);
  },
};

export default tracer;
