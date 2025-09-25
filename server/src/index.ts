import fs from 'fs/promises';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { loadConfig } from './utils/env';
import { createRunRouter } from './routes/runRoutes';
import { graphRouter } from './routes/graphRoutes';

async function bootstrap() {
  const config = loadConfig();
  const app = express();

  await fs.mkdir(config.runsDir, { recursive: true });

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(graphRouter);
  app.use(createRunRouter(config));

  app.use('/runs/assets', express.static(config.runsDir));

  const port = config.port;
  app.listen(port, () => {
    console.log(`Brainstormer backend listening on http://localhost:${port}`);
    console.log(`Run artifacts stored in ${path.resolve(config.runsDir)}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
