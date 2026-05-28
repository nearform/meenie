import { z } from "zod";

const Schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  APP_BASE_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_CLIENT_ID: z.string().min(1),
  SLACK_CLIENT_SECRET: z.string().min(1),
  SLACK_STATE_SECRET: z.string().min(16),
  SLACK_BOT_TOKEN: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Config = z.infer<typeof Schema>;

export const config: Config = Schema.parse(process.env);
