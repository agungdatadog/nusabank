package com.nusabank.loan.tracing;

import datadog.trace.api.CorrelationIdentifier;
import datadog.trace.api.interceptor.MutableSpan;
import io.opentracing.Span;
import io.opentracing.util.GlobalTracer;

/**
 * Thin access to the SSI-injected tracer. Only dd-trace-api and the OpenTracing API are
 * on the classpath; without the agent (unit tests) every call is a no-op.
 */
public final class Spans {
    private Spans() {}

    /** Tags the local root span (the HTTP request), where business attributes belong. */
    public static void tagRoot(String key, String value) {
        Span active = GlobalTracer.get().activeSpan();
        if (active instanceof MutableSpan mutable) {
            mutable.getLocalRootSpan().setTag(key, value);
        } else if (active != null) {
            active.setTag(key, value);
        }
    }

    public static void setUser(String cif, String segment) {
        tagRoot("usr.id", cif);
        if (segment != null) tagRoot("usr.segment", segment);
    }

    public static String traceId() {
        String id = CorrelationIdentifier.getTraceId();
        return id == null || "0".equals(id) ? null : id;
    }
}
