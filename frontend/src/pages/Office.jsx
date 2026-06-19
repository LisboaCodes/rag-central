import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, ContactShadows, RoundedBox } from '@react-three/drei';
import { X } from 'lucide-react';
import { useStatus } from '../lib/StatusContext.jsx';
import { useAgents, hexOf } from '../lib/AgentsContext.jsx';
import AgentChat from '../components/AgentChat.jsx';

// ---------------------------------------------------------------------------
// Escritório 3D isométrico voxel (estilo OpenClaw / Crossy Road) — Three.js
// via react-three-fiber. Cada boneco é um agente real do roster; plaquinha
// flutuante com nome + status. Clicar abre o chat (POST /chat + RAG).
// ---------------------------------------------------------------------------

// paleta low-poly pastel
const C = {
  floor: '#dcd5c8',
  rug: '#c7bdec',
  rugCopa: '#bfe3d4',
  wall: '#b08a93',
  wallTop: '#9c7882',
  glass: '#aec3da',
  wood: '#b08968',
  woodDark: '#8a6a52',
  screen: '#2dd4bf',
  chair: '#374151',
  plantPot: '#a9745b',
  plant: '#4caf50',
  rack: '#1f2937',
  sofa: '#5b6b8c',
  skin: '#e8b58b'
};

// caixa sólida simples (voxel)
function Box({ args, position, color, opacity, ...p }) {
  return (
    <mesh position={position} castShadow receiveShadow {...p}>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} transparent={opacity != null} opacity={opacity ?? 1} roughness={0.85} metalness={0.05} />
    </mesh>
  );
}

// ---- personagem voxel (pernas/braços com pivô pra animar o caminhar) ------
function VoxelCharacter({ color, legL, legR, armL, armR }) {
  return (
    <group>
      {/* pernas — group com pivô no quadril (y=0.5) pra balançar */}
      <group ref={legL} position={[-0.14, 0.5, 0]}>
        <Box args={[0.22, 0.5, 0.28]} position={[0, -0.25, 0]} color="#2b3344" />
      </group>
      <group ref={legR} position={[0.14, 0.5, 0]}>
        <Box args={[0.22, 0.5, 0.28]} position={[0, -0.25, 0]} color="#2b3344" />
      </group>
      {/* tronco (cor do agente) */}
      <RoundedBox args={[0.62, 0.66, 0.36]} radius={0.06} smoothness={3} position={[0, 0.83, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.8} />
      </RoundedBox>
      {/* braços — pivô no ombro (y=1.1) */}
      <group ref={armL} position={[-0.4, 1.1, 0]}>
        <Box args={[0.16, 0.55, 0.22]} position={[0, -0.25, 0]} color={color} />
      </group>
      <group ref={armR} position={[0.4, 1.1, 0]}>
        <Box args={[0.16, 0.55, 0.22]} position={[0, -0.25, 0]} color={color} />
      </group>
      {/* pescoço */}
      <Box args={[0.18, 0.1, 0.18]} position={[0, 1.2, 0]} color={C.skin} />
      {/* cabeça */}
      <RoundedBox args={[0.46, 0.46, 0.44]} radius={0.08} smoothness={3} position={[0, 1.48, 0]} castShadow>
        <meshStandardMaterial color={C.skin} roughness={0.7} />
      </RoundedBox>
      {/* cabelo */}
      <Box args={[0.5, 0.14, 0.48]} position={[0, 1.7, 0]} color="#2a2118" />
      {/* olhos (frente = +z) */}
      <Box args={[0.07, 0.07, 0.02]} position={[-0.1, 1.5, 0.23]} color="#1b1b1b" />
      <Box args={[0.07, 0.07, 0.02]} position={[0.1, 1.5, 0.23]} color="#1b1b1b" />
    </group>
  );
}

// ---- mesa de trabalho (mesa + monitor + cadeira) --------------------------
function Desk({ position, rotation }) {
  return (
    <group position={position} rotation={rotation}>
      <Box args={[1.5, 0.1, 0.8]} position={[0, 0.75, 0]} color={C.wood} />
      <Box args={[0.1, 0.75, 0.1]} position={[-0.65, 0.37, 0.3]} color={C.woodDark} />
      <Box args={[0.1, 0.75, 0.1]} position={[0.65, 0.37, 0.3]} color={C.woodDark} />
      <Box args={[0.1, 0.75, 0.1]} position={[-0.65, 0.37, -0.3]} color={C.woodDark} />
      <Box args={[0.1, 0.75, 0.1]} position={[0.65, 0.37, -0.3]} color={C.woodDark} />
      {/* monitor */}
      <Box args={[0.6, 0.4, 0.05]} position={[0, 1.15, -0.2]} color="#111827" />
      <Box args={[0.54, 0.34, 0.02]} position={[0, 1.15, -0.17]} color={C.screen} />
      <Box args={[0.16, 0.12, 0.16]} position={[0, 0.9, -0.2]} color="#111827" />
      {/* cadeira */}
      <Box args={[0.45, 0.1, 0.45]} position={[0, 0.5, 0.6]} color={C.chair} />
      <Box args={[0.45, 0.5, 0.1]} position={[0, 0.75, 0.82]} color={C.chair} />
    </group>
  );
}

function Plant({ position }) {
  return (
    <group position={position}>
      <Box args={[0.34, 0.34, 0.34]} position={[0, 0.17, 0]} color={C.plantPot} />
      <Box args={[0.5, 0.5, 0.5]} position={[0, 0.65, 0]} color={C.plant} />
      <Box args={[0.34, 0.34, 0.34]} position={[0, 1.0, 0]} color="#5fbf63" />
    </group>
  );
}

function ServerRack({ position }) {
  return (
    <group position={position}>
      <Box args={[0.8, 1.8, 0.7]} position={[0, 0.9, 0]} color={C.rack} />
      {[0.4, 0.8, 1.2, 1.5].map((y, i) => (
        <Box key={i} args={[0.7, 0.08, 0.02]} position={[0, y, 0.36]} color={i % 2 ? '#22d3ee' : '#34d399'} />
      ))}
    </group>
  );
}

function Sofa({ position, rotation }) {
  return (
    <group position={position} rotation={rotation}>
      <Box args={[1.6, 0.4, 0.7]} position={[0, 0.3, 0]} color={C.sofa} />
      <Box args={[1.6, 0.5, 0.2]} position={[0, 0.6, -0.32]} color={C.sofa} />
      <Box args={[0.2, 0.5, 0.7]} position={[-0.8, 0.55, 0]} color={C.sofa} />
      <Box args={[0.2, 0.5, 0.7]} position={[0.8, 0.55, 0]} color={C.sofa} />
    </group>
  );
}

// ---- sala (piso, tapetes, paredes externas, sala de reunião envidraçada) --
const FW = 22, FD = 16; // floor width/depth
function Room() {
  return (
    <group>
      {/* piso */}
      <Box args={[FW, 0.4, FD]} position={[0, -0.2, 0]} color={C.floor} receiveShadow />
      {/* tapetes (zonas) */}
      <Box args={[7, 0.02, 5]} position={[-4, 0.02, 3.5]} color={C.rug} />
      <Box args={[5, 0.02, 4]} position={[6.5, 0.02, 4]} color={C.rugCopa} />
      {/* paredes externas (fundo e laterais) */}
      <Box args={[FW, 3, 0.4]} position={[0, 1.3, -FD / 2]} color={C.wall} />
      <Box args={[FW, 0.4, 0.4]} position={[0, 2.9, -FD / 2]} color={C.wallTop} />
      <Box args={[0.4, 3, FD]} position={[-FW / 2, 1.3, 0]} color={C.wall} />
      <Box args={[0.4, 0.4, FD]} position={[-FW / 2, 2.9, 0]} color={C.wallTop} />
      <Box args={[0.4, 3, FD]} position={[FW / 2, 1.3, 0]} color={C.wall} />
      <Box args={[0.4, 0.4, FD]} position={[FW / 2, 2.9, 0]} color={C.wallTop} />

      {/* sala de reunião envidraçada (canto de trás) */}
      <group position={[-2.5, 0, -4]}>
        <Box args={[6, 1.8, 0.12]} position={[0, 0.9, 2]} color={C.glass} opacity={0.28} />
        <Box args={[0.12, 1.8, 4]} position={[3, 0.9, 0]} color={C.glass} opacity={0.28} />
        {/* mesa redonda de reunião */}
        <mesh position={[0, 0.75, 0]} castShadow>
          <cylinderGeometry args={[1.5, 1.5, 0.12, 24]} />
          <meshStandardMaterial color={C.wood} roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.37, 0]}>
          <cylinderGeometry args={[0.2, 0.3, 0.75, 12]} />
          <meshStandardMaterial color={C.woodDark} />
        </mesh>
      </group>
    </group>
  );
}

// móveis estáticos espalhados
function Furniture() {
  return (
    <group>
      <Plant position={[-FW / 2 + 1, 0, FD / 2 - 1]} />
      <Plant position={[FW / 2 - 1, 0, FD / 2 - 1]} />
      <Plant position={[FW / 2 - 1, 0, -FD / 2 + 1]} />
      <ServerRack position={[FW / 2 - 1.2, 0, -FD / 2 + 2.5]} />
      <ServerRack position={[FW / 2 - 1.2, 0, -FD / 2 + 4]} />
      <Sofa position={[6.5, 0, 4]} rotation={[0, Math.PI, 0]} />
      <Sofa position={[8, 0, 2.5]} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}

// área onde os agentes circulam (evita paredes e a sala de reunião do fundo)
const WALK = { minX: -8, maxX: 8, minZ: -1.5, maxZ: 6 };
const rand = (a, b) => a + Math.random() * (b - a);
const randTarget = () => ({ x: rand(WALK.minX, WALK.maxX), z: rand(WALK.minZ, WALK.maxZ) });

// ---- agente no 3D (anda sozinho pelo escritório) --------------------------
function Agent({ a, start, active, selected, onSelect }) {
  const g = useRef();
  const legL = useRef(), legR = useRef(), armL = useRef(), armR = useRef();
  const st = useRef({
    x: start[0], z: start[2], tx: start[0], tz: start[2],
    pauseUntil: 1 + Math.random() * 3, speed: 0.9 + Math.random() * 0.7,
    face: Math.PI, phase: Math.random() * 10
  });

  useFrame((state, delta) => {
    const s = st.current;
    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);
    let moving = false;

    if (t >= s.pauseUntil) {
      const dx = s.tx - s.x, dz = s.tz - s.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) {
        // chegou ao destino → pausa e sorteia o próximo
        s.pauseUntil = t + 1 + Math.random() * 4;
        const nt = randTarget(); s.tx = nt.x; s.tz = nt.z;
      } else {
        const step = Math.min(d, s.speed * dt);
        s.x += (dx / d) * step; s.z += (dz / d) * step;
        s.face = Math.atan2(dx, dz);
        moving = true;
      }
    }

    if (g.current) {
      g.current.position.x = s.x; g.current.position.z = s.z;
      g.current.position.y = moving ? Math.abs(Math.sin(t * 9)) * 0.05 : Math.sin(t * 1.8 + s.phase) * 0.04;
      // rotaciona suavemente até a direção do movimento
      let diff = s.face - g.current.rotation.y;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      g.current.rotation.y += diff * Math.min(1, dt * 10);
    }

    // balanço de pernas/braços ao caminhar
    const swing = moving ? Math.sin(t * 9) * 0.5 : 0;
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    if (armL.current) armL.current.rotation.x = -swing * 0.8;
    if (armR.current) armR.current.rotation.x = swing * 0.8;
  });

  const color = hexOf(a.color);
  return (
    <group
      ref={g}
      position={start}
      onClick={(e) => { e.stopPropagation(); onSelect(a); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = 'auto'; }}
    >
      <VoxelCharacter color={color} legL={legL} legR={legR} armL={armL} armR={armR} />

      {/* anel de seleção */}
      {selected && (
        <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.55, 0.72, 32]} />
          <meshBasicMaterial color="#3b82f6" transparent opacity={0.9} />
        </mesh>
      )}

      {/* plaquinha flutuante (nome + status) */}
      <Html position={[0, 2.3, 0]} center distanceFactor={11} zIndexRange={[20, 0]} pointerEvents="none">
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
          background: 'rgba(13,15,24,0.92)', color: '#fff', padding: '3px 9px',
          borderRadius: 7, fontSize: 13, fontWeight: 600,
          fontFamily: 'ui-sans-serif, system-ui', border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)'
        }}>
          {a.name}
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: active ? '#22c55e' : '#f59e0b' }} />
        </div>
      </Html>
    </group>
  );
}

// distribui os agentes numa grade na área central/frontal
function layoutFor(n) {
  const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(n))));
  const gapX = 2.6, gapZ = 2.4;
  const rows = Math.ceil(n / cols);
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const rowCount = Math.min(cols, n - r * cols);
    const x = (c - (rowCount - 1) / 2) * gapX;
    const z = 1.5 + (r - (rows - 1) / 2) * gapZ;
    out.push({ pos: [x, 0, z], face: Math.PI }); // de frente pra câmera
  }
  return out;
}

function Scene({ agents, status, selectedKey, onSelect }) {
  const slots = useMemo(() => layoutFor(agents.length), [agents.length]);
  const now = Date.now();
  return (
    <>
      <ambientLight intensity={0.75} />
      <directionalLight position={[8, 14, 6]} intensity={1.1} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-6, 8, -4]} intensity={0.3} />

      <Room />
      <Furniture />

      {/* mesas atrás dos agentes */}
      {slots.map((s, i) => (
        <Desk key={`d${i}`} position={[s.pos[0], 0, s.pos[2] - 1.3]} rotation={[0, 0, 0]} />
      ))}

      {agents.map((a, i) => {
        const act = status?.activity?.agents?.[a.key];
        const active = act?.last_query_at ? (now - new Date(act.last_query_at).getTime() < 60000) : false;
        const s = slots[i] || { pos: [0, 0, 0] };
        return (
          <Agent key={a.key} a={a} start={s.pos}
            active={active} selected={selectedKey === a.key} onSelect={onSelect} />
        );
      })}

      <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={26} blur={2.2} far={6} />
      <OrbitControls
        target={[0, 1, 1]}
        enablePan={false}
        minDistance={10}
        maxDistance={26}
        minPolarAngle={Math.PI / 8}
        maxPolarAngle={Math.PI / 2.6}
      />
    </>
  );
}

export default function Office() {
  const { status } = useStatus();
  const { agents } = useAgents();
  const [chatAgent, setChatAgent] = useState(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          Arraste pra <strong className="text-body">girar</strong> · role pra <strong className="text-body">zoom</strong> ·
          clique num agente pra <strong className="text-body">conversar</strong>.
        </p>
        <span className="flex items-center gap-1.5 rounded-full border border-edge bg-surface px-3 py-1 text-xs text-muted">
          {agents.length} agentes no escritório
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-edge bg-[#cfc8bb]" style={{ height: 540 }}>
        <Canvas shadows camera={{ position: [13, 13, 15], fov: 34 }} dpr={[1, 2]}>
          <color attach="background" args={['#cfc8bb']} />
          <fog attach="fog" args={['#cfc8bb', 30, 55]} />
          <Scene agents={agents} status={status} selectedKey={chatAgent?.key} onSelect={setChatAgent} />
        </Canvas>
      </div>

      {chatAgent && (
        <div className="flex h-[400px] flex-col overflow-hidden rounded-xl border border-edge bg-surface">
          <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
            {chatAgent.avatar_url ? (
              <img src={chatAgent.avatar_url} alt={chatAgent.name} className="h-9 w-9 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
                style={{ background: hexOf(chatAgent.color) }}>
                {chatAgent.name}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{chatAgent.name}</p>
              <p className="truncate text-[11px] text-muted">{chatAgent.role} · {chatAgent.model}</p>
            </div>
            <button onClick={() => setChatAgent(null)} className="rounded p-1 text-muted hover:bg-white/10 hover:text-body">
              <X size={16} />
            </button>
          </div>
          <AgentChat agent={chatAgent} className="min-h-0 flex-1" />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {agents.map((a) => {
          const q = status?.activity?.agents?.[a.key]?.queries ?? 0;
          return (
            <button
              key={a.key}
              onClick={() => setChatAgent(a)}
              className="flex items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-2 transition-colors hover:border-blue-500"
            >
              <span className="h-3 w-3 rounded-full" style={{ background: hexOf(a.color) }} />
              <span className="text-sm font-semibold">{a.name}</span>
              <span className="text-[11px] text-muted">{a.role}</span>
              <span className="ml-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-bold">{q} queries</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
