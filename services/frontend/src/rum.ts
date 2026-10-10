import { datadogRum } from "@datadog/browser-rum";

interface RuntimeConfig {
  rumApplicationId?: string;
  rumClientToken?: string;
  rumRemoteConfigId?: string;
  env?: string;
  version?: string;
}

declare global {
  interface Window {
    NUSABANK_CONFIG?: RuntimeConfig;
  }
}

export function initRum() {
  const cfg = window.NUSABANK_CONFIG ?? {};
  if (!cfg.rumApplicationId || !cfg.rumClientToken) return;
  datadogRum.init({
    applicationId: cfg.rumApplicationId,
    clientToken: cfg.rumClientToken,
    site: "datadoghq.com",
    service: "nusabank-frontend",
    env: cfg.env ?? "demo",
    version: cfg.version,
    sessionSampleRate: 100,
    sessionReplaySampleRate: 100,
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,
    // Account numbers and balances are shown, but anything typed (passwords, OTP) is masked.
    defaultPrivacyLevel: "mask-user-input",
    // RUM <-> APM: the API is same-origin under /api, so every fetch carries trace headers
    // and each browser request links to its backend trace.
    allowedTracingUrls: [
      { match: (url: string) => url.startsWith(`${window.location.origin}/api/`), propagatorTypes: ["datadog", "tracecontext"] },
    ],
    traceSampleRate: 100,
    ...(cfg.rumRemoteConfigId ? { remoteConfigurationId: cfg.rumRemoteConfigId } : {}),
  });
}

export function rumSetUser(user: { cif: string; name: string; segment: string }) {
  datadogRum.setUser({ id: user.cif, name: user.name, segment: user.segment });
}

export function rumClearUser() {
  datadogRum.clearUser();
}

/** Business actions shown in RUM analytics and funnels (e.g. transfer by rail). */
export function rumAction(name: string, context: Record<string, unknown>) {
  datadogRum.addAction(name, context);
}

export function rumError(error: unknown, context: Record<string, unknown> = {}) {
  datadogRum.addError(error, context);
}
