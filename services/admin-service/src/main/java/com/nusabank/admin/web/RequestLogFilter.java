package com.nusabank.admin.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;

/**
 * One log line per request, emitted while the request span is active so the injected
 * tracer puts dd.trace_id / dd.span_id in the MDC (log <-> trace correlation).
 */
@Component
public class RequestLogFilter extends OncePerRequestFilter {
    private static final Logger log = LoggerFactory.getLogger(RequestLogFilter.class);

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return path.equals("/healthz") || path.equals("/readyz");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        long start = System.nanoTime();
        try {
            chain.doFilter(req, res);
        } finally {
            Object route = req.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
            long ms = (System.nanoTime() - start) / 1_000_000;
            int status = res.getStatus();
            if (status >= 500) {
                log.error("request completed method={} route={} status={} duration_ms={}", req.getMethod(), route, status, ms);
            } else {
                log.info("request completed method={} route={} status={} duration_ms={}", req.getMethod(), route, status, ms);
            }
        }
    }
}
