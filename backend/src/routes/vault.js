import { Router } from 'express';
import { requireAuth, tokenFingerprint } from '../services/auth.js';
import * as vault from '../services/vault.js';
import { logEvent } from '../services/activity.js';

const router = Router();

// Todo o Cofre exige sessão de login válida.
router.use(requireAuth);

// fingerprint da sessão -> chaveia o estado de "cofre aberto"
function fp(req) { return tokenFingerprint(req.authToken); }

// GET /vault/status — { initialized, unlocked }
router.get('/status', async (req, res, next) => {
  try { res.json(await vault.vaultStatus(fp(req))); } catch (err) { next(err); }
});

// POST /vault/setup { password } — define a senha-mestra (1ª vez)
router.post('/setup', async (req, res, next) => {
  try {
    await vault.setupMaster(req.body?.password);
    await vault.unlock(fp(req), req.body?.password);
    logEvent('INFO', 'vault', `cofre inicializado por ${req.user.email}`);
    res.json({ ok: true, ...(await vault.vaultStatus(fp(req))) });
  } catch (err) { next(err); }
});

// POST /vault/unlock { password } — abre o cofre nesta sessão
router.post('/unlock', async (req, res, next) => {
  try {
    await vault.unlock(fp(req), req.body?.password);
    res.json({ ok: true, unlocked: true });
  } catch (err) { next(err); }
});

// POST /vault/lock — fecha o cofre
router.post('/lock', (req, res) => {
  vault.lock(fp(req));
  res.json({ ok: true, unlocked: false });
});

// ---- contas de e-mail -----------------------------------------------------
// ?reveal=1 traz as senhas decifradas (usado pelo botão "mostrar")
router.get('/accounts', async (req, res, next) => {
  try { res.json({ accounts: await vault.getAccounts(fp(req), { reveal: req.query.reveal === '1' }) }); } catch (err) { next(err); }
});
router.post('/accounts', async (req, res, next) => {
  try { res.json(await vault.addAccount(fp(req), req.body || {})); } catch (err) { next(err); }
});
router.put('/accounts/:id', async (req, res, next) => {
  try { res.json(await vault.editAccount(fp(req), parseInt(req.params.id, 10), req.body || {})); } catch (err) { next(err); }
});
router.delete('/accounts/:id', async (req, res, next) => {
  try { res.json({ deleted: await vault.removeAccount(fp(req), parseInt(req.params.id, 10)) }); } catch (err) { next(err); }
});

// ---- serviços -------------------------------------------------------------
router.get('/services', async (req, res, next) => {
  try { res.json({ services: await vault.getServices(fp(req), { reveal: req.query.reveal === '1' }) }); } catch (err) { next(err); }
});
router.post('/services', async (req, res, next) => {
  try { res.json(await vault.addService(fp(req), req.body || {})); } catch (err) { next(err); }
});
router.put('/services/:id', async (req, res, next) => {
  try { res.json(await vault.editService(fp(req), parseInt(req.params.id, 10), req.body || {})); } catch (err) { next(err); }
});
router.delete('/services/:id', async (req, res, next) => {
  try { res.json({ deleted: await vault.removeService(fp(req), parseInt(req.params.id, 10)) }); } catch (err) { next(err); }
});

export default router;
