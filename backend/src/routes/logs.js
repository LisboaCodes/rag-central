import { Router } from 'express';
import { getLogs } from '../services/activity.js';

const router = Router();

// GET /logs?level=INFO|WARN|ERROR&service=query&limit=100
// Eventos em memória (resetam no restart do backend).
router.get('/', (req, res) => {
  const { level, service, limit } = req.query;
  res.json({ logs: getLogs({ level, service, limit }) });
});

export default router;
