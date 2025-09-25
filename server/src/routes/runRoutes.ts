import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import type { AppConfig } from '../utils/env';
import { createRunId, runPipeline } from '../pipeline/runPipeline';
import type { SeedInput } from '../pipeline/types';
import { runEventHub } from '../events/runEvents';

function normalizeSeed(body: any): SeedInput {
  if (!body || typeof body !== 'object') {
    throw new Error('Request body must be an object.');
  }
  const { goal, audience, constraints, n, k } = body;
  if (!goal || !audience || !constraints) {
    throw new Error('Missing required seed fields: goal, audience, constraints.');
  }
  const seed: SeedInput = {
    goal: String(goal),
    audience: String(audience),
    constraints: String(constraints),
  };
  if (n !== undefined) {
    const parsedN = Number(n);
    if (!Number.isInteger(parsedN) || parsedN <= 0) {
      throw new Error('n must be a positive integer.');
    }
    seed.n = parsedN;
  }
  if (k !== undefined) {
    const parsedK = Number(k);
    if (!Number.isInteger(parsedK) || parsedK <= 0) {
      throw new Error('k must be a positive integer.');
    }
    seed.k = parsedK;
  }
  return seed;
}

async function readRunState(config: AppConfig, runId: string) {
  const statePath = path.join(config.runsDir, runId, 'state.json');
  const file = await fs.readFile(statePath, 'utf-8');
  return JSON.parse(file);
}

async function readNodeIO(config: AppConfig, runId: string) {
  const nodeDir = path.join(config.runsDir, runId, 'node_io');
  const result: Record<string, unknown> = {};
  try {
    const entries = await fs.readdir(nodeDir);
    await Promise.all(
      entries.map(async (fileName) => {
        if (!fileName.endsWith('.json')) return;
        const nodeId = fileName.replace(/\.json$/, '');
        const content = await fs.readFile(path.join(nodeDir, fileName), 'utf-8');
        result[nodeId] = JSON.parse(content);
      }),
    );
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
  return result;
}

export function createRunRouter(config: AppConfig) {
  const router = Router();
  router.post('/run', async (req, res) => {
    try {
      const seed = normalizeSeed(req.body);
      const runId = createRunId();
      const emitter = runEventHub.create(runId);
      res.status(202).json({ runId });
      runPipeline(config, seed, emitter, runId).catch((error) => {
        console.error(`Run ${runId} failed:`, error);
      });
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  });

  router.get('/runs', async (_req, res) => {
    try {
      const dirs = await fs.readdir(config.runsDir, { withFileTypes: true });
      const states = await Promise.all(
        dirs
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            try {
              return await readRunState(config, entry.name);
            } catch (err: any) {
              if (err.code === 'ENOENT') return null;
              throw err;
            }
          }),
      );
      const payload = states
        .filter(Boolean)
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  router.get('/runs/:id', async (req, res) => {
    const runId = req.params.id;
    try {
      const state = await readRunState(config, runId);
      const nodeIO = await readNodeIO(config, runId);
      const briefPath = path.join(config.runsDir, runId, 'brief.md');
      const usagePath = path.join(config.runsDir, runId, 'token_usage.json');
      const response: Record<string, unknown> = { state, nodeIO };
      try {
        const brief = await fs.readFile(briefPath, 'utf-8');
        response.brief = brief;
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
      try {
        const usage = await fs.readFile(usagePath, 'utf-8');
        response.usage = JSON.parse(usage);
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
      res.json(response);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        res.status(404).json({ error: 'Run not found.' });
      } else {
        res.status(500).json({ error: (error as Error).message });
      }
    }
  });

  router.get('/runs/:id/events', async (req, res) => {
    const runId = req.params.id;
    const emitter = runEventHub.get(runId);
    if (!emitter) {
      res.status(404).json({ error: 'Run not found or finished.' });
      return;
    }
    runEventHub.subscribe(runId, res);
  });

  router.get('/runs/:id/brief', async (req, res) => {
    const filePath = path.join(config.runsDir, req.params.id, 'brief.md');
    try {
      await fs.access(filePath);
      res.sendFile(filePath);
    } catch (error) {
      res.status(404).json({ error: 'Brief not found.' });
    }
  });

  return router;
}
