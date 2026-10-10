package com.nusabank.loan.web;

import org.springframework.http.HttpStatus;

/** A failure with a known HTTP status, code and customer-facing message. */
public class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;
    private final String partner;

    public ApiException(HttpStatus status, String code, String message) {
        this(status, code, message, null);
    }

    public ApiException(HttpStatus status, String code, String message, String partner) {
        super(message);
        this.status = status;
        this.code = code;
        this.partner = partner;
    }

    public HttpStatus status() { return status; }
    public String code() { return code; }
    public String partner() { return partner; }

    public static ApiException badRequest(String msg) {
        return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", msg);
    }

    public static ApiException unauthorized() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Sesi tidak valid, silakan login kembali");
    }

    public static ApiException notFound(String msg) {
        return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", msg);
    }
}
