function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  mongo: {
    host: process.env.MONGODB_HOST ?? "mongodb.nusabank.svc.cluster.local:27017",
    database: process.env.MONGODB_DATABASE ?? "chat",
    user: process.env.MONGODB_USER ?? "chat",
    password: required("MONGODB_PASSWORD"),
  },
  jwtSecret: required("JWT_SECRET"),
  // "faq": built-in intent responder (until ai-agent ships). "agent": ai-agent answers,
  // and its failures surface as 502s naming the partner — the EP4 story.
  responder: (process.env.CHAT_RESPONDER ?? "faq") as "faq" | "agent",
  aiAgentUrl: process.env.AI_AGENT_URL ?? "http://ai-agent.nusabank.svc.cluster.local:8080",
  agentTimeoutMs: Number(process.env.AGENT_TIMEOUT_MS ?? 30000),
  maxMessagesPerSession: 200,
};
