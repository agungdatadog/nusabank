package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"time"

	kafkatrace "github.com/DataDog/dd-trace-go/contrib/segmentio/kafka-go/v2"
	"github.com/DataDog/dd-trace-go/v2/ddtrace/tracer"
	"github.com/segmentio/kafka-go"
)

const topicTransfer = "payments.transfer.v1"

// enqueue writes an event in the caller's transaction, with the current trace context
// saved alongside it so a later (sweeper) publish still joins the original trace.
func enqueue(ctx context.Context, tx *sql.Tx, topic, key string, payload any) (int64, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	carrier := map[string]string{}
	if span, ok := tracer.SpanFromContext(ctx); ok {
		_ = tracer.Inject(span.Context(), tracer.TextMapCarrier(carrier))
	}
	cb, _ := json.Marshal(carrier)
	var id int64
	err = tx.QueryRowContext(ctx,
		"INSERT INTO outbox (topic, msg_key, payload, carrier) VALUES ($1, $2, $3, $4) RETURNING id",
		topic, key, body, cb).Scan(&id)
	return id, err
}

type outbox struct {
	db     *sql.DB
	writer *kafkatrace.KafkaWriter
}

func newOutbox(db *sql.DB, brokers []string) *outbox {
	// The traced writer injects trace context and DSM checkpoints into message headers.
	w := kafkatrace.WrapWriter(&kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireAll,
		BatchTimeout: 10 * time.Millisecond,
		WriteTimeout: 5 * time.Second,
	})
	return &outbox{db: db, writer: w}
}

type outboxRow struct {
	id      int64
	topic   string
	key     string
	payload []byte
	carrier []byte
}

// publishNow sends specific rows inside the request's trace; failures are left for the sweeper.
func (o *outbox) publishNow(ctx context.Context, ids ...int64) {
	for _, id := range ids {
		var row outboxRow
		err := o.db.QueryRowContext(ctx,
			"SELECT id, topic, msg_key, payload, carrier FROM outbox WHERE id = $1 AND sent_at IS NULL", id).
			Scan(&row.id, &row.topic, &row.key, &row.payload, &row.carrier)
		if err != nil {
			continue
		}
		o.send(ctx, row)
	}
}

func (o *outbox) send(ctx context.Context, row outboxRow) bool {
	err := o.writer.WriteMessages(ctx, kafka.Message{Topic: row.topic, Key: []byte(row.key), Value: row.payload})
	if err != nil {
		slog.WarnContext(ctx, "outbox publish failed, sweeper will retry", "topic", row.topic, "outbox_id", row.id, "error", err)
		return false
	}
	if _, err := o.db.ExecContext(ctx, "UPDATE outbox SET sent_at = now() WHERE id = $1", row.id); err != nil {
		slog.ErrorContext(ctx, "outbox mark-sent failed; event may be re-published (consumers are idempotent)", "outbox_id", row.id, "error", err)
	}
	return true
}

// sweep re-publishes anything left unsent, resuming each event's original trace.
func (o *outbox) sweep(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		rows, err := o.db.QueryContext(ctx, `SELECT id, topic, msg_key, payload, carrier FROM outbox
			WHERE sent_at IS NULL AND created_at < now() - interval '5 seconds' ORDER BY id LIMIT 100`)
		if err != nil {
			continue
		}
		var pending []outboxRow
		for rows.Next() {
			var r outboxRow
			if rows.Scan(&r.id, &r.topic, &r.key, &r.payload, &r.carrier) == nil {
				pending = append(pending, r)
			}
		}
		rows.Close()
		for _, r := range pending {
			var carrier map[string]string
			_ = json.Unmarshal(r.carrier, &carrier)
			opts := []tracer.StartSpanOption{tracer.ResourceName("outbox.sweep " + r.topic)}
			if parent, err := tracer.Extract(tracer.TextMapCarrier(carrier)); err == nil {
				opts = append(opts, tracer.ChildOf(parent))
			}
			span, sctx := tracer.StartSpanFromContext(ctx, "outbox.publish", opts...)
			o.send(sctx, r)
			span.Finish()
		}
	}
}
