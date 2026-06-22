import { useState } from 'react';
import { BrainCircuit, Mail, MessageCircle, Loader2, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';

// Login em 3 passos: e-mail -> código do e-mail (Resend) -> código do WhatsApp.
export default function Login() {
  const { login } = useAuth();
  const [stage, setStage] = useState('email');   // email | emailCode | waCode
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function reset(toStage) { setCode(''); setError(''); setStage(toStage); }

  async function submitEmail(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const r = await api.auth.login(email.trim());
      setSentTo(r.sentTo || email);
      reset('emailCode');
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  async function submitEmailCode(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const r = await api.auth.verifyEmail(email.trim(), code.trim());
      setSentTo(r.sentTo || '');
      reset('waCode');
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  async function submitWaCode(e) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const r = await api.auth.verify2fa(email.trim(), code.trim());
      login(r.token, r.email);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0d0f18] p-4">
      <div className="w-full max-w-sm rounded-2xl border border-edge bg-surface/60 p-7 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-600">
            <BrainCircuit size={20} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-wide">RAG CENTRAL</p>
            <p className="text-[10px] text-muted">Acesso seguro · CERBERUS</p>
          </div>
        </div>

        {stage === 'email' && (
          <form onSubmit={submitEmail} className="space-y-4">
            <Step icon={Mail} title="Entrar com e-mail" desc="Vamos enviar um código para o seu e-mail." />
            <input
              type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className="w-full rounded-lg border border-edge bg-[#0d0f18] px-3 py-2.5 text-sm outline-none focus:border-blue-500"
            />
            <SubmitBtn loading={loading}>Enviar código</SubmitBtn>
          </form>
        )}

        {stage === 'emailCode' && (
          <form onSubmit={submitEmailCode} className="space-y-4">
            <Step icon={Mail} title="Código do e-mail" desc={`Enviado para ${sentTo}. Verifique a caixa de entrada.`} />
            <CodeInput value={code} onChange={setCode} />
            <SubmitBtn loading={loading}>Verificar</SubmitBtn>
            <BackBtn onClick={() => reset('email')}>Trocar e-mail</BackBtn>
          </form>
        )}

        {stage === 'waCode' && (
          <form onSubmit={submitWaCode} className="space-y-4">
            <Step icon={MessageCircle} title="2ª etapa · WhatsApp" desc={`Código enviado para o WhatsApp ${sentTo}.`} />
            <CodeInput value={code} onChange={setCode} />
            <SubmitBtn loading={loading}>Entrar</SubmitBtn>
            <BackBtn onClick={() => reset('email')}>Recomeçar</BackBtn>
          </form>
        )}

        {error && <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function Step({ icon: Icon, title, desc }) {
  return (
    <div>
      <p className="flex items-center gap-2 text-sm font-semibold"><Icon size={16} className="text-blue-400" />{title}</p>
      <p className="mt-1 text-xs text-muted">{desc}</p>
    </div>
  );
}

function CodeInput({ value, onChange }) {
  return (
    <input
      inputMode="numeric" pattern="[0-9]*" maxLength={6} required autoFocus
      value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      placeholder="000000"
      className="w-full rounded-lg border border-edge bg-[#0d0f18] px-3 py-3 text-center text-2xl font-bold tracking-[0.5em] outline-none focus:border-blue-500"
    />
  );
}

function SubmitBtn({ loading, children }) {
  return (
    <button
      type="submit" disabled={loading}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-violet-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

function BackBtn({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-center gap-1.5 text-xs text-muted hover:text-body">
      <ArrowLeft size={13} />{children}
    </button>
  );
}
