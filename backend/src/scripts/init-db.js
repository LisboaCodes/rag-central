import 'dotenv/config';
import { initSchema, pool } from '../services/db.js';

try {
  await initSchema();
  console.log('Schema criado/verificado com sucesso.');
} catch (err) {
  console.error('Falha ao criar schema:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
