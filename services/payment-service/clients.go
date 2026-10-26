package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	httptrace "github.com/DataDog/dd-trace-go/contrib/net/http/v2"
	"github.com/DataDog/dd-trace-go/v2/ddtrace/tracer"
)

const (
	partnerAccount = "account-service"
	partnerBIFAST  = "bifast"
	partnerSKN     = "skn"
)

// downstream wraps an instrumented client; each call is a span whose peer is named.
type downstream struct {
	base   string
	client *http.Client
}

func newDownstream(base string, timeout time.Duration) *downstream {
	return &downstream{base: base, client: httptrace.WrapClient(&http.Client{Timeout: timeout})}
}

type callResult struct {
	status int
	body   []byte
}

func (d *downstream) do(ctx context.Context, method, path string, headers map[string]string, in any) (callResult, error) {
	var body io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, d.base+path, body)
	if err != nil {
		return callResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return callResult{}, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return callResult{status: resp.StatusCode, body: b}, nil
}

// ---- account-service (/internal) ----

type accountRef struct {
	AccountNumber string `json:"account_number"`
	CIF           string `json:"cif"`
	OwnerName     string `json:"owner_name"`
	Currency      string `json:"currency"`
	Status        string `json:"status"`
}

type accountClient struct{ *downstream }

func (a accountClient) lookup(ctx context.Context, number string) (*accountRef, error) {
	res, err := a.do(ctx, http.MethodGet, "/internal/accounts/"+number, nil, nil)
	if err != nil || res.status >= 500 {
		return nil, errPartner(http.StatusBadGateway, "PARTNER_UNAVAILABLE", "Layanan rekening sedang tidak tersedia", partnerAccount)
	}
	if res.status == http.StatusNotFound {
		return nil, nil
	}
	var ref accountRef
	if err := json.Unmarshal(res.body, &ref); err != nil {
		return nil, fmt.Errorf("account lookup: %w", err)
	}
	return &ref, nil
}

// hold reserves amount+fee. A 422 from account-service is a business rejection
// (insufficient balance, ineligible account) and is passed through as-is.
func (a accountClient) hold(ctx context.Context, number string, total int64, reference, idempotencyKey string) (string, error) {
	res, err := a.do(ctx, http.MethodPost, "/internal/accounts/"+number+"/holds",
		map[string]string{"Idempotency-Key": idempotencyKey},
		map[string]any{"amount": idr(total), "reference": reference, "purpose": "TRANSFER"})
	if err != nil || res.status >= 500 {
		return "", errPartner(http.StatusBadGateway, "PARTNER_UNAVAILABLE", "Layanan rekening sedang tidak tersedia", partnerAccount)
	}
	if res.status == http.StatusUnprocessableEntity {
		var e apiError
		_ = json.Unmarshal(res.body, &e)
		return "", &apiError{status: http.StatusUnprocessableEntity, Code: e.Code, Message: e.Message}
	}
	if res.status != http.StatusCreated {
		return "", fmt.Errorf("unexpected hold status %d: %s", res.status, res.body)
	}
	var h struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(res.body, &h); err != nil {
		return "", err
	}
	return h.ID, nil
}

func (a accountClient) release(ctx context.Context, holdID string) error {
	res, err := a.do(ctx, http.MethodDelete, "/internal/holds/"+holdID, nil, nil)
	if err != nil {
		return err
	}
	if res.status != http.StatusNoContent && res.status != http.StatusNotFound {
		return fmt.Errorf("release hold %s: status %d", holdID, res.status)
	}
	return nil
}

// ---- partner-mock rails ----

type railClient struct{ *downstream }

// partnerCall runs one rail call inside a client span tagged peer.service, so BI FAST and
// SKN show up as inferred services of their own (Service Map: payment -> bifast) rather
// than as one "partner-mock" host. A 5xx or transport error marks the span as an error.
func (rc railClient) partnerCall(ctx context.Context, peer, operation, path string, body any) (callResult, error) {
	span, ctx := tracer.StartSpanFromContext(ctx, "partner.request",
		tracer.ResourceName(peer+" "+operation), tracer.Tag("peer.service", peer),
		tracer.Tag("partner.name", peer), tracer.Tag("span.kind", "client"))
	res, err := rc.do(ctx, http.MethodPost, path, nil, body)
	span.SetTag("http.status_code", res.status)
	switch {
	case err != nil:
		span.Finish(tracer.WithError(err))
	case res.status >= 500:
		span.Finish(tracer.WithError(fmt.Errorf("%s responded %d", peer, res.status)))
	default:
		span.Finish()
	}
	return res, err
}

// railError maps a rail outage to 503 (unavailable) or 504-ish timeout as 503 with a
// distinct code, naming the rail.
func railError(partner string, res callResult, err error) *apiError {
	name := map[string]string{partnerBIFAST: "BI FAST", partnerSKN: "SKN"}[partner]
	if err != nil || res.status == http.StatusGatewayTimeout {
		return errPartner(http.StatusServiceUnavailable, "PARTNER_TIMEOUT", name+" tidak merespons, silakan coba lagi", partner)
	}
	return errPartner(http.StatusBadGateway, "PARTNER_UNAVAILABLE", name+" sedang gangguan, silakan coba lagi", partner)
}

func (rc railClient) inquiry(ctx context.Context, bankCode, account string) (string, error) {
	res, err := rc.partnerCall(ctx, partnerBIFAST, "account-inquiry", "/bifast/v1/account-inquiry",
		map[string]string{"bank_code": bankCode, "account_number": account})
	if err != nil || res.status >= 500 {
		return "", railError(partnerBIFAST, res, err)
	}
	if res.status == http.StatusNotFound {
		return "", &apiError{status: http.StatusUnprocessableEntity, Code: "ACCOUNT_NOT_FOUND", Message: "Rekening tujuan tidak ditemukan"}
	}
	var out struct {
		AccountName string `json:"account_name"`
	}
	if err := json.Unmarshal(res.body, &out); err != nil {
		return "", err
	}
	return out.AccountName, nil
}

type railTransfer struct {
	Reference                string `json:"reference"`
	SourceBankCode           string `json:"source_bank_code"`
	SourceAccountNumber      string `json:"source_account_number"`
	SourceAccountName        string `json:"source_account_name"`
	DestinationBankCode      string `json:"destination_bank_code"`
	DestinationAccountNumber string `json:"destination_account_number"`
	Amount                   Money  `json:"amount"`
	Note                     string `json:"note,omitempty"`
}

type railOutcome struct {
	rejected      bool // business rejection by the beneficiary bank
	railReference string
	windowID      string
}

func (rc railClient) bifast(ctx context.Context, t railTransfer) (railOutcome, error) {
	res, err := rc.partnerCall(ctx, partnerBIFAST, "credit-transfer", "/bifast/v1/credit-transfer", t)
	if err != nil || res.status >= 500 {
		return railOutcome{}, railError(partnerBIFAST, res, err)
	}
	if res.status == http.StatusUnprocessableEntity {
		return railOutcome{rejected: true}, nil
	}
	var out struct {
		RailReference string `json:"rail_reference"`
	}
	if err := json.Unmarshal(res.body, &out); err != nil {
		return railOutcome{}, err
	}
	return railOutcome{railReference: out.RailReference}, nil
}

func (rc railClient) skn(ctx context.Context, t railTransfer) (railOutcome, error) {
	res, err := rc.partnerCall(ctx, partnerSKN, "transfer", "/skn/v1/transfers", t)
	if err != nil || res.status >= 500 {
		return railOutcome{}, railError(partnerSKN, res, err)
	}
	var out struct {
		RailReference string `json:"rail_reference"`
		WindowID      string `json:"window_id"`
	}
	if err := json.Unmarshal(res.body, &out); err != nil {
		return railOutcome{}, err
	}
	return railOutcome{railReference: out.RailReference, windowID: out.WindowID}, nil
}
