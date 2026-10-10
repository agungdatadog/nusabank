function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  db: {
    host: required("DB_HOST"),
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME ?? "biller",
    user: process.env.DB_USER ?? "biller",
    password: required("DB_PASSWORD"),
  },
  jwtSecret: required("JWT_SECRET"),
  accountServiceUrl: process.env.ACCOUNT_SERVICE_URL ?? "http://account-service.nusabank.svc.cluster.local:8080",
  partnerMockUrl: process.env.PARTNER_MOCK_URL ?? "http://partner-mock.nusabank.svc.cluster.local:8080",
  kafkaBrokers: (process.env.KAFKA_BOOTSTRAP ?? "nusabank-kafka-kafka-bootstrap.nusabank.svc.cluster.local:9092").split(","),
  inquiryTtlSeconds: 600,
  // A biller that has not answered by then may still have accepted: the payment goes
  // PENDING and the reconciler asks again, instead of guessing either way.
  partnerTimeoutMs: Number(process.env.PARTNER_TIMEOUT_MS ?? 8000),
  reconcileAfterSeconds: 60,
  reconcileMaxAttempts: 10,
};
