// Must be the first import: dd-trace patches http and pg as they are required.
// DD_SERVICE / DD_ENV / DD_VERSION / DD_AGENT_HOST come from the Admission Controller.
import tracer from "dd-trace";

tracer.init({
  logInjection: true,
  runtimeMetrics: true,
});

// Probe traffic would drown business spans in APM.
tracer.use("http", { server: { blocklist: ["/healthz", "/readyz"] } });

export default tracer;
