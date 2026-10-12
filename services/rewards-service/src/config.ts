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
    database: process.env.DB_NAME ?? "rewards",
    user: process.env.DB_USER ?? "rewards",
    password: required("DB_PASSWORD"),
  },
  jwtSecret: required("JWT_SECRET"),
  kafkaBrokers: (process.env.KAFKA_BOOTSTRAP ?? "nusabank-kafka-kafka-bootstrap.nusabank.svc.cluster.local:9092").split(","),
  seedFile: process.env.SEED_FILE ?? "/app/seed/customers.json",
};
