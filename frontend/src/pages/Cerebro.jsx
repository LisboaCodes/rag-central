import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Shuffle, Maximize2, X } from 'lucide-react';
import { api } from '../lib/api.js';

// cores por tipo de nó
const KIND = {
  fato:      { color: '#a78bfa', label: 'Fato consolidado' },
  nota:      { color: '#34d399', label: 'Nota de agente' },
  documento: { color: '#60a5fa', label: 'Documento' },
  mensagem:  { color: '#22d3ee', label: 'Mensagem' },
  agent:     { color: '#fbbf24', label: 'Agente' },
  project:   { color: '#64748b', label: 'Projeto' }
};
const colorOf = (k) => (KIND[k]?.color || '#94a3b8');
const isHub = (k) => k === 'agent' || k === 'project';

const DENSITY = { Alta: 0.62, Média: 0.72, Baixa: 0.8 };

export default function Cerebro() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const sim = useRef({ nodes: [], links: [], cam: { x: 0, y: 0, scale: 1 }, alpha: 1, drag: null, pan: null, hover: null, adj: new Map() });
  const rafRef = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState('');
  const [density, setDensity] = useState('Média');
  const [hubs, setHubs] = useState(true);
  const [messages, setMessages] = useState(false);
  const [linkTypes, setLinkTypes] = useState({ sim: true, agent: true, project: true });
  const [selected, setSelected] = useState(null);

  // espelham o estado pro loop de render (que é criado só uma vez)
  const linkTypesRef = useRef(linkTypes);
  const selectedRef = useRef(selected);
  useEffect(() => { linkTypesRef.current = linkTypes; }, [linkTypes]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // ---- carregar dados do grafo --------------------------------------------
  const fetchGraph = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.memory.graph({ project: project || undefined, threshold: DENSITY[density], hubs, messages, limit: 400 });
      buildSim(r.nodes, r.links);
      setStats(r.stats);
      setSelected(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [project, density, hubs, messages]);

  useEffect(() => { api.memory.facets().then((f) => setProjects(f.projects.map((p) => p.project))).catch(() => {}); }, []);
  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  // monta os nós/arestas da simulação a partir do payload do backend
  function buildSim(rawNodes, rawLinks) {
    const W = wrapRef.current?.clientWidth || 800;
    const H = wrapRef.current?.clientHeight || 600;
    const map = new Map();
    const N = rawNodes.length || 1;
    const nodes = rawNodes.map((n, i) => {
      // posição inicial em espiral pra evitar sobreposição total no boot
      const a = i * 2.399; // ângulo áureo
      const rad = 12 * Math.sqrt(i);
      const node = {
        ...n,
        x: Math.cos(a) * rad + (Math.random() - 0.5) * 20,
        y: Math.sin(a) * rad + (Math.random() - 0.5) * 20,
        vx: 0, vy: 0, deg: 0, fx: null, fy: null
      };
      map.set(n.id, node);
      return node;
    });
    const adj = new Map();
    const links = [];
    for (const l of rawLinks) {
      const s = map.get(l.source), t = map.get(l.target);
      if (!s || !t) continue;
      links.push({ ...l, s, t });
      s.deg++; t.deg++;
      if (!adj.has(s.id)) adj.set(s.id, new Set());
      if (!adj.has(t.id)) adj.set(t.id, new Set());
      adj.get(s.id).add(t.id);
      adj.get(t.id).add(s.id);
    }
    // raio por tipo/grau
    for (const n of nodes) {
      const base = isHub(n.kind) ? 7 : 3.5;
      n.r = base + Math.min(8, Math.sqrt(n.deg) * (isHub(n.kind) ? 2.2 : 1.1));
    }
    const cam = { x: W / 2, y: H / 2, scale: 1 };
    sim.current = { ...sim.current, nodes, links, adj, cam, alpha: 1, drag: null, pan: null, hover: null };
  }

  // ---- loop de simulação + render -----------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let stopped = false;

    function resize() {
      const W = wrapRef.current.clientWidth, H = wrapRef.current.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current);

    function step() {
      const S = sim.current;
      const { nodes, links } = S;
      if (S.alpha > 0.02 && nodes.length) {
        // repulsão (Coulomb) — O(n²), ok pro tamanho usado
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            let dx = a.x - b.x, dy = a.y - b.y;
            let d2 = dx * dx + dy * dy || 0.01;
            if (d2 > 90000) continue; // ignora pares muito distantes
            const d = Math.sqrt(d2);
            const f = 900 / d2;
            const fx = (dx / d) * f, fy = (dy / d) * f;
            a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
          }
        }
        // molas (arestas)
        for (const l of links) {
          const target = l.type === 'sim' ? 70 - (l.sim - 0.6) * 80 : (l.type === 'project' ? 120 : 90);
          let dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const k = l.type === 'sim' ? 0.02 : 0.012;
          const f = (d - Math.max(30, target)) * k;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          l.s.vx += fx; l.s.vy += fy; l.t.vx -= fx; l.t.vy -= fy;
        }
        // gravidade ao centro + integração
        for (const n of nodes) {
          n.vx += -n.x * 0.005; n.vy += -n.y * 0.005;
          if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0; continue; }
          n.vx *= 0.85; n.vy *= 0.85;
          n.x += n.vx * S.alpha; n.y += n.vy * S.alpha;
        }
        S.alpha *= 0.99;
      }
      draw(ctx);
      if (!stopped) rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);

    return () => { stopped = true; cancelAnimationFrame(rafRef.current); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw(ctx) {
    const S = sim.current;
    const { cam, nodes, links, adj, hover } = S;
    const dpr = window.devicePixelRatio || 1;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.scale, cam.scale);

    const focusId = selectedRef.current?.id || hover;
    const neigh = focusId ? adj.get(focusId) : null;
    const lt = linkTypesRef.current;

    // arestas
    for (const l of links) {
      if (!lt[l.type]) continue;
      const active = focusId && (l.s.id === focusId || l.t.id === focusId);
      const dim = focusId && !active;
      ctx.beginPath();
      ctx.moveTo(l.s.x, l.s.y);
      ctx.lineTo(l.t.x, l.t.y);
      if (l.type === 'sim') {
        ctx.strokeStyle = active ? 'rgba(167,139,250,0.9)' : `rgba(120,140,200,${dim ? 0.04 : 0.10 + (l.sim - 0.6) * 0.4})`;
        ctx.lineWidth = (active ? 1.6 : 0.6) / cam.scale;
      } else {
        const c = l.type === 'agent' ? '251,191,36' : '100,116,139';
        ctx.strokeStyle = active ? `rgba(${c},0.7)` : `rgba(${c},${dim ? 0.03 : 0.12})`;
        ctx.lineWidth = (active ? 1.2 : 0.5) / cam.scale;
      }
      ctx.stroke();
    }

    // nós
    const showLabels = cam.scale > 1.25;
    for (const n of nodes) {
      const focused = focusId && (n.id === focusId || (neigh && neigh.has(n.id)));
      const dim = focusId && !focused;
      const col = colorOf(n.kind);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = dim ? hexA(col, 0.18) : col;
      ctx.fill();
      if (n.id === focusId) {
        ctx.lineWidth = 2 / cam.scale; ctx.strokeStyle = '#fff'; ctx.stroke();
      }
      if (isHub(n.kind) || showLabels || focused) {
        const fs = (isHub(n.kind) ? 11 : 9) / cam.scale;
        ctx.font = `${fs}px ui-sans-serif, system-ui`;
        ctx.fillStyle = dim ? 'rgba(200,210,230,0.25)' : (isHub(n.kind) ? '#e5e7eb' : 'rgba(200,210,230,0.8)');
        ctx.textAlign = 'center';
        const txt = (n.label || '').slice(0, 22);
        ctx.fillText(txt, n.x, n.y + n.r + fs + 1);
      }
    }
  }

  // ---- interação (mouse) ---------------------------------------------------
  function toWorld(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const S = sim.current;
    return {
      x: (e.clientX - rect.left - S.cam.x) / S.cam.scale,
      y: (e.clientY - rect.top - S.cam.y) / S.cam.scale,
      sx: e.clientX - rect.left, sy: e.clientY - rect.top
    };
  }
  function pick(wx, wy) {
    const { nodes } = sim.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const dx = n.x - wx, dy = n.y - wy;
      if (dx * dx + dy * dy <= (n.r + 3) ** 2) return n;
    }
    return null;
  }
  function onDown(e) {
    const p = toWorld(e);
    const n = pick(p.x, p.y);
    if (n) sim.current.drag = { node: n, moved: false };
    else sim.current.pan = { x: e.clientX, y: e.clientY, moved: false };
  }
  function onMove(e) {
    const S = sim.current;
    if (S.drag) {
      const p = toWorld(e);
      S.drag.node.fx = p.x; S.drag.node.fy = p.y;
      S.drag.moved = true; S.alpha = Math.max(S.alpha, 0.5);
    } else if (S.pan) {
      S.cam.x += e.clientX - S.pan.x; S.cam.y += e.clientY - S.pan.y;
      S.pan.x = e.clientX; S.pan.y = e.clientY; S.pan.moved = true;
    } else {
      const p = toWorld(e);
      const n = pick(p.x, p.y);
      S.hover = n?.id || null;
      canvasRef.current.style.cursor = n ? 'pointer' : 'grab';
    }
  }
  function onUp() {
    const S = sim.current;
    if (S.drag) {
      if (!S.drag.moved) setSelected({ ...S.drag.node }); // clique = seleciona
      S.drag.node.fx = null; S.drag.node.fy = null;
      S.drag = null;
    } else if (S.pan) {
      if (!S.pan.moved) setSelected(null); // clique no vazio = limpa
      S.pan = null;
    }
  }
  function onWheel(e) {
    e.preventDefault();
    const S = sim.current;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const ns = Math.max(0.2, Math.min(5, S.cam.scale * factor));
    // zoom em direção ao cursor
    S.cam.x = mx - (mx - S.cam.x) * (ns / S.cam.scale);
    S.cam.y = my - (my - S.cam.y) * (ns / S.cam.scale);
    S.cam.scale = ns;
  }

  function reheat() { sim.current.alpha = 0.9; }
  function fit() {
    const S = sim.current, ns = S.nodes;
    if (!ns.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of ns) { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y); }
    const W = wrapRef.current.clientWidth, H = wrapRef.current.clientHeight;
    const gw = (maxX - minX) || 1, gh = (maxY - minY) || 1;
    const scale = Math.min(5, Math.max(0.2, 0.85 * Math.min(W / gw, H / gh)));
    S.cam.scale = scale;
    S.cam.x = W / 2 - ((minX + maxX) / 2) * scale;
    S.cam.y = H / 2 - ((minY + maxY) / 2) * scale;
  }

  return (
    <div className="space-y-3">
      {/* controles */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={project} onChange={(e) => setProject(e.target.value)}
          className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
          <option value="">Todos os projetos</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={density} onChange={(e) => setDensity(e.target.value)}
          className="rounded-lg border border-edge bg-surface px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          title="Quão parecidos dois pontos precisam ser pra se conectarem">
          {Object.keys(DENSITY).map((d) => <option key={d} value={d}>Conexões: {d}</option>)}
        </select>

        <label className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-muted">
          <input type="checkbox" checked={hubs} onChange={(e) => setHubs(e.target.checked)} className="accent-blue-500" />
          Hubs (agente/projeto)
        </label>
        <label
          className={`flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-2 text-sm ${project ? 'cursor-not-allowed opacity-40' : 'text-muted'}`}
          title={project ? 'Mensagens não têm projeto — limpe o filtro de projeto pra incluí-las' : 'Inclui as mensagens cruas das conversas'}
        >
          <input type="checkbox" checked={messages} disabled={!!project} onChange={(e) => setMessages(e.target.checked)} className="accent-cyan-500" />
          Mensagens cruas
        </label>

        {/* toggles de tipo de aresta (cliente) */}
        <div className="flex items-center gap-1 rounded-lg border border-edge bg-surface px-2 py-1 text-xs">
          {[['sim', 'semânticas'], ['agent', 'agente'], ['project', 'projeto']].map(([k, lbl]) => (
            <button key={k}
              onClick={() => setLinkTypes((t) => ({ ...t, [k]: !t[k] }))}
              className={`rounded px-2 py-1 ${linkTypes[k] ? 'bg-blue-500/20 text-blue-300' : 'text-muted hover:text-body'}`}>
              {lbl}
            </button>
          ))}
        </div>

        <button onClick={fit} className="rounded-lg border border-edge bg-surface p-2 text-muted hover:text-body" title="Enquadrar"><Maximize2 size={15} /></button>
        <button onClick={reheat} className="rounded-lg border border-edge bg-surface p-2 text-muted hover:text-body" title="Reorganizar"><Shuffle size={15} /></button>
        <button onClick={fetchGraph} className="rounded-lg border border-edge bg-surface p-2 text-muted hover:text-body" title="Atualizar"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /></button>

        {stats && <span className="ml-auto text-xs text-muted">{stats.nodes} nós · {stats.sim_edges} conexões semânticas</span>}
      </div>

      {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>}

      {/* canvas + painel */}
      <div ref={wrapRef} className="relative h-[calc(100vh-190px)] min-h-[420px] overflow-hidden rounded-xl border border-edge bg-[#0b1020]">
        <canvas
          ref={canvasRef}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
          onWheel={onWheel}
          className="block touch-none"
          style={{ cursor: 'grab' }}
        />

        {/* legenda */}
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-lg bg-black/40 px-3 py-2 text-[11px] backdrop-blur">
          {Object.entries(KIND).map(([k, v]) => (
            <span key={k} className="flex items-center gap-2 text-body/80">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: v.color }} /> {v.label}
            </span>
          ))}
        </div>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">Montando o cérebro…</div>
        )}
        {!loading && stats?.nodes === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted">
            Ainda não há conhecimento suficiente. Suba arquivos em <span className="mx-1 text-blue-400">Ingestão</span> ou converse com os agentes pra começar a formar o cérebro.
          </div>
        )}

        {/* painel do nó selecionado */}
        {selected && (
          <div className="absolute right-3 top-3 w-72 rounded-xl border border-edge bg-surface/95 p-4 text-sm shadow-xl backdrop-blur">
            <div className="mb-2 flex items-start justify-between gap-2">
              <span className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ background: hexA(colorOf(selected.kind), 0.18), color: colorOf(selected.kind) }}>
                {KIND[selected.kind]?.label || selected.kind}
              </span>
              <button onClick={() => setSelected(null)} className="text-muted hover:text-body"><X size={15} /></button>
            </div>
            <p className="mb-2 font-medium text-body">{selected.label}</p>
            {selected.agent && <p className="text-xs text-muted">👤 {selected.agent}</p>}
            {selected.project && <p className="text-xs text-muted">📁 {selected.project}</p>}
            {selected.text && (
              <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[13px] text-body/80">{selected.text}</p>
            )}
            {(selected.id?.startsWith('doc:') || selected.id?.startsWith('msg:')) && (
              <a href={`/memoria?uid=${encodeURIComponent(selected.id)}`} className="mt-3 block text-xs text-blue-400 hover:underline">Editar na Central de Memória →</a>
            )}
            {selected.id?.startsWith('msg:') && selected.conv && (
              <a href={`/conversas?id=${selected.conv}`} className="mt-1.5 block text-xs text-cyan-400 hover:underline">Ver conversa completa →</a>
            )}
          </div>
        )}
      </div>

      <p className="text-center text-[11px] text-muted/70">
        Arraste o fundo pra mover · role pra dar zoom · arraste um nó pra reposicionar · clique pra ver o conteúdo
      </p>
    </div>
  );
}

// cor hex + alpha → rgba
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
