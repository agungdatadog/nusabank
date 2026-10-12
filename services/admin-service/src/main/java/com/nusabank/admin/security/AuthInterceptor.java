package com.nusabank.admin.security;

import com.nusabank.admin.tracing.Spans;
import com.nusabank.admin.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Every admin endpoint except login needs an operator token; customer tokens are rejected. */
@Configuration
public class AuthInterceptor implements HandlerInterceptor, WebMvcConfigurer {
    public static final String CLAIMS = "nusabank.claims";
    private final JwtVerifier verifier;

    public AuthInterceptor(JwtVerifier verifier) {
        this.verifier = verifier;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(this).addPathPatterns("/api/admin/**").excludePathPatterns("/api/admin/login");
    }

    @Override
    public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
        String header = req.getHeader("Authorization");
        JwtVerifier.Claims claims = header != null && header.startsWith("Bearer ")
                ? verifier.verify(header.substring(7)) : null;
        if (claims == null || claims.sub() == null || !"operator".equals(claims.role())) throw ApiException.unauthorized();
        req.setAttribute(CLAIMS, claims);
        Spans.setOperator(claims.sub());
        return true;
    }
}
