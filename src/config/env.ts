import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  RABBITMQ_URL: z.string().url('RABBITMQ_URL must be a valid AMQP URL').default('amqp://mipit:mipit@localhost:5672'),
  QUEUE_NAME: z.string().min(1).default('payments.route.breb'),
  ACK_ROUTING_KEY: z.string().min(1).default('ack.breb'),
  EXCHANGE_NAME: z.string().min(1).default('mipit.payments'),
  BREB_SANDBOX_URL: z.string().url('BREB_SANDBOX_URL must be a valid URL').default('http://localhost:9003'),
  BREB_MODE: z.enum(['sandbox', 'mock']).default('mock'),
  BREB_MOCK_PORT: z.coerce.number().int().positive().default(9003),
  BREB_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  BREB_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().default('http://localhost:4318'),
  OTEL_SERVICE_NAME: z.string().min(1).default('mipit-adapter-breb'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HEALTH_PORT: z.coerce.number().int().positive().default(9103),
  INSTANCE_ID: z.string().default(`breb-${process.pid}`),
});

function validateEnv() {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('\n  ');
      console.error('❌ Environment variables validation failed:\n  ' + missingVars);
      process.exit(1);
    }
    throw error;
  }
}

export const env = validateEnv();
export type Env = z.infer<typeof envSchema>;
