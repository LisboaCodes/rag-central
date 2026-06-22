import { Router } from 'express';
import {
  authEnabled, startLogin, verifyEmailCode, verify2faCode, requireAuth
} from '../services/auth.js';
import { resendConfigured } from '../services/resend.js';
import { getSettings } from '../services/settings.js';

const router = Router();

// GET /auth/config — público. O front usa para saber se deve exigir login.
router.get('/config', (req, res) => {
  const s = getSettings();
  res.json({
    enabled: authEnabled(),
    resendReady: resendConfigured(),
    whatsappReady: Boolean(s.WHATSAPP_ENABLED && s.AUTH_2FA_NUMBER),
    allowedConfigured: Boolean(String(s.AUTH_ALLOWED_EMAILS || '').trim())
  });
});

// POST /auth/login { email } — fator 1: dispara código por e-mail
router.post('/login', async (req, res, next) => {
  try {
    if (!authEnabled()) return res.status(400).json({ error: 'Login está desativado nas Configurações' });
    res.json(await startLogin(req.body?.email));
  } catch (err) { next(err); }
});

// POST /auth/verify-email { email, code } — fator 1 ok -> dispara WhatsApp
router.post('/verify-email', async (req, res, next) => {
  try {
    res.json(await verifyEmailCode(req.body?.email, req.body?.code));
  } catch (err) { next(err); }
});

// POST /auth/verify-2fa { email, code } — fator 2 ok -> emite token
router.post('/verify-2fa', async (req, res, next) => {
  try {
    res.json(await verify2faCode(req.body?.email, req.body?.code));
  } catch (err) { next(err); }
});

// GET /auth/me — valida o token atual
router.get('/me', requireAuth, (req, res) => {
  res.json({ email: req.user.email });
});

export default router;
