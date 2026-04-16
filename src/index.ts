// dotenv must be loaded before any other imports that read process.env
import './config/env';

import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { testConnection } from './config/db';
import router from './routes/index';
import { errorMiddleware } from './middlewares/error.middleware';

const app = express();

// ─────────────────────────────────────────────
// Global Middlewares
// ─────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────
app.use('/api', router);

// Health check — useful for Render and uptime monitors
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', environment: env.NODE_ENV });
});

// ─────────────────────────────────────────────
// Global Error Handler (must be last middleware)
// ─────────────────────────────────────────────
app.use(errorMiddleware);

// ─────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  await testConnection();
  // '0.0.0.0' binds to all network interfaces — required by Render and most cloud hosts.
  // Without it, the server only listens on localhost and Render never detects it as ready.
  app.listen(env.PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${env.PORT} [${env.NODE_ENV}]`);
  });
}

bootstrap().catch((error: unknown) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
