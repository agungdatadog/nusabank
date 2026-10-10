function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  db: {
    host: required("DB_HOST"),
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? "auth",
    user: process.env.DB_USER ?? "auth",
    password: required("DB_PASSWORD"),
  },
  jwtSecret: required("JWT_SECRET"),
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 7 * 24 * 3600,
  mfaChallengeTtlSeconds: 300,
  // Simulated SMS gateway: every challenge "sends" this OTP. Demo-only by design.
  demoOtp: required("DEMO_MFA_OTP"),
  // Password for every synthetic customer in catalog/seed/customers.json.
  demoCustomerPassword: required("DEMO_CUSTOMER_PASSWORD"),
  seedFile: process.env.SEED_FILE ?? "/app/seed/customers.json",
};
