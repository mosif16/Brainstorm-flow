import { Router } from 'express';
import { GRAPH } from '../pipeline/runPipeline';

export const graphRouter = Router();

graphRouter.get('/graph', (_req, res) => {
  res.json(GRAPH);
});
