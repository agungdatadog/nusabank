package com.nusabank.loan.web;

import com.nusabank.loan.tracing.Spans;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** Maps failures to catalog/openapi.yaml#/components/schemas/Error with the AGENTS.md status rules. */
@RestControllerAdvice
public class GlobalErrorHandler {
    private static final Logger log = LoggerFactory.getLogger(GlobalErrorHandler.class);

    public record ErrorBody(String code, String message, String partner, String traceId) {}

    private static ResponseEntity<ErrorBody> body(HttpStatus status, String code, String msg, String partner) {
        return ResponseEntity.status(status).body(new ErrorBody(code, msg, partner, Spans.traceId()));
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ErrorBody> api(ApiException e) {
        if (e.partner() != null) {
            log.warn("downstream failure partner={} code={} message={}", e.partner(), e.code(), e.getMessage());
            Spans.tagRoot("error.partner", e.partner());
        }
        return body(e.status(), e.code(), e.getMessage(), e.partner());
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class,
            MissingRequestHeaderException.class, MissingServletRequestParameterException.class,
            MissingServletRequestPartException.class, MaxUploadSizeExceededException.class})
    ResponseEntity<ErrorBody> malformed(Exception e) {
        return body(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "Permintaan tidak valid: " + e.getMessage(), null);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ErrorBody> noRoute(NoResourceFoundException e) {
        return body(HttpStatus.NOT_FOUND, "NOT_FOUND", "Endpoint tidak ditemukan", null);
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<ErrorBody> database(DataAccessException e) {
        log.error("database failure", e);
        return body(HttpStatus.INTERNAL_SERVER_ERROR, "DATABASE_ERROR", "Terjadi kesalahan, silakan coba lagi", null);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorBody> unexpected(Exception e) {
        log.error("unhandled error", e);
        return body(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "Terjadi kesalahan, silakan coba lagi", null);
    }
}
