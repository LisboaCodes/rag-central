import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useStatus } from '../lib/StatusContext.jsx';
import { useAgents, hexOf } from '../lib/AgentsContext.jsx';
import AgentChat from '../components/AgentChat.jsx';

// ---------------------------------------------------------------------------
// Escritório 2D estilo Gather.town — Canvas puro, sem libs externas.
// Cada boneco é um agente real do roster. Comportamento dirigido por
// /status → activity.agents (queries → modo ativo). Clicar num boneco
// abre um painel de chat que fala com POST /chat (Ollama + RAG).
// ---------------------------------------------------------------------------

const TS = 32;          // tamanho do tile em px
const GW = 26;          // largura do mapa em tiles
const GH = 16;          // altura do mapa em tiles
// logo da empresa (letreiro na parede). Servida de frontend/public/logo.png
const LOGO_IMG = typeof Image !== 'undefined' ? new Image() : null;
if (LOGO_IMG) LOGO_IMG.src = '/logo.png';

const SPEED = 70;       // velocidade dos agentes (px/s)
const PLAYER_SPEED = 100; // velocidade do jogador (px/s)
const NEAR_DIST = TS * 1.7; // distância pra mostrar "ASK"
const ACTIVE_MS = 12000; // tempo em "modo ativo" após uma query

// pool de estações (mesa + assento). Agentes recebem por índice; se houver
// mais agentes que estações no pool, geramos novas em linha.
const STATION_POOL = [
  { desk: [[3, 3], [4, 3]],     seat: [3, 4],   face: 'up' },
  { desk: [[21, 3], [22, 3]],   seat: [22, 4],  face: 'up' },
  { desk: [[3, 12], [4, 12]],   seat: [3, 11],  face: 'down' },
  { desk: [[21, 12], [22, 12]], seat: [22, 11], face: 'down' },
  { desk: [[7, 3], [8, 3]],     seat: [7, 4],   face: 'up' },
  { desk: [[17, 3], [18, 3]],   seat: [18, 4],  face: 'up' },
  { desk: [[7, 12], [8, 12]],   seat: [7, 11],  face: 'down' },
  { desk: [[17, 12], [18, 12]], seat: [18, 11], face: 'down' }
];

function stationFor(i) {
  if (i < STATION_POOL.length) return STATION_POOL[i];
  // fallback: assentos extras numa fileira central
  const col = 6 + (i % 14);
  return { desk: [[col, 6]], seat: [col, 7], face: 'up' };
}

const TABLE = [];
for (let x = 11; x <= 14; x++) for (let y = 7; y <= 8; y++) TABLE.push([x, y]);

const PLANTS = [[2, 8], [23, 8], [13, 13], [2, 4], [23, 4], [9, 13], [16, 13]];

// zonas usadas pela rotina (definidas em ZONES logo abaixo)

// zonas de piso — só visual (não bloqueiam). [x, y, w, h, cor, rótulo]
const ZONES = [
  { x: 9, y: 6, w: 8, h: 4, color: 'rgba(139,92,246,0.16)', label: 'Reunião' },
  { x: 8, y: 11, w: 9, h: 3, color: 'rgba(59,130,246,0.14)', label: 'Lounge' },
  { x: 19, y: 10, w: 5, h: 4, color: 'rgba(16,185,129,0.12)', label: 'Copa' },
  { x: 1, y: 1, w: 24, h: 2, color: 'rgba(245,158,11,0.06)', label: '' }
];
const ZONE_REUNIAO = ZONES.find((z) => z.label === 'Reunião');
const ZONE_COPA = ZONES.find((z) => z.label === 'Copa');

// mobília que BLOQUEIA a passagem (desenhada + adicionada à colisão)
const FURNITURE = [
  { type: 'bookshelf', tiles: [[2, 1], [3, 1]] },
  { type: 'bookshelf', tiles: [[22, 1], [23, 1]] },
  { type: 'sofa', tiles: [[9, 12], [10, 12]], face: 'up' },
  { type: 'sofa', tiles: [[14, 12], [15, 12]], face: 'up' },
  { type: 'coffee', tiles: [[12, 12]] },
  { type: 'counter', tiles: [[23, 11], [23, 12]] },
  { type: 'cooler', tiles: [[2, 12]] }
];

function buildGrid(stations) {
  const g = Array.from({ length: GH }, () => Array(GW).fill(1));
  for (let x = 0; x < GW; x++) { g[0][x] = 0; g[GH - 1][x] = 0; }
  for (let y = 0; y < GH; y++) { g[y][0] = 0; g[y][GW - 1] = 0; }
  stations.forEach((s) => s.desk.forEach(([x, y]) => { if (g[y]?.[x] !== undefined) g[y][x] = 0; }));
  TABLE.forEach(([x, y]) => { g[y][x] = 0; });
  PLANTS.forEach(([x, y]) => { if (g[y]?.[x] !== undefined) g[y][x] = 0; });
  FURNITURE.forEach((f) => f.tiles.forEach(([x, y]) => { if (g[y]?.[x] !== undefined) g[y][x] = 0; }));
  return g;
}

function findPath(grid, start, goal) {
  if (grid[goal.y]?.[goal.x] !== 1) return null;
  const key = (x, y) => y * GW + x;
  const came = new Map([[key(start.x, start.y), null]]);
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    if (cur.x === goal.x && cur.y === goal.y) {
      const path = [];
      let c = cur;
      while (c) { path.unshift(c); c = came.get(key(c.x, c.y)); }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      if (grid[ny][nx] !== 1) continue;
      const nk = key(nx, ny);
      if (came.has(nk)) continue;
      came.set(nk, cur);
      q.push({ x: nx, y: ny });
    }
  }
  return null;
}

function randomTileInRect(grid, r) {
  for (let i = 0; i < 60; i++) {
    const x = r.x + Math.floor(Math.random() * r.w);
    const y = r.y + Math.floor(Math.random() * r.h);
    if (grid[y]?.[x] === 1) return { x, y };
  }
  return null;
}

// rotina do escritório pelo horário REAL local
function scheduleMode() {
  const d = new Date();
  const h = d.getHours(), m = d.getMinutes();
  if ((h === 10 || h === 15) && m < 15) return 'meeting'; // standups
  if (h === 12 || (h === 16 && m >= 0 && m < 20)) return 'coffee'; // almoço / café da tarde
  if (h >= 9 && h < 18) return 'work';
  return 'free';
}
const SCHEDULE_LABEL = { meeting: 'Reunião', coffee: 'Café', work: 'Trabalhando', free: 'Livre' };

function randomFloorTile(grid) {
  for (let i = 0; i < 100; i++) {
    const x = 1 + Math.floor(Math.random() * (GW - 2));
    const y = 1 + Math.floor(Math.random() * (GH - 2));
    if (grid[y][x] === 1) return { x, y };
  }
  return null;
}

const tileCenter = (t) => ({ x: t.x * TS + TS / 2, y: t.y * TS + TS / 2 });

// --- desenho ---------------------------------------------------------------

function drawRoom(ctx) {
  // piso parquet (madeira clara) com leve veio por tile
  for (let y = 1; y < GH - 1; y++) {
    for (let x = 1; x < GW - 1; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#cdbb96' : '#c6b48d';
      ctx.fillRect(x * TS, y * TS, TS, TS);
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.fillRect(x * TS, y * TS + TS - 2, TS, 2);
    }
  }

  // zonas (tapetes coloridos das áreas)
  ZONES.forEach((z) => {
    ctx.fillStyle = z.color;
    roundRect(ctx, z.x * TS + 2, z.y * TS + 2, z.w * TS - 4, z.h * TS - 4, 10); ctx.fill();
  });

  // paredes (madeira escura) com rodapé e janelas
  const wall = '#5b4a39', wallTop = '#6d5a45', glass = '#9fd3e8';
  for (let x = 0; x < GW; x++) { ctx.fillStyle = wall; ctx.fillRect(x * TS, 0, TS, TS); ctx.fillRect(x * TS, (GH - 1) * TS, TS, TS); }
  for (let y = 0; y < GH; y++) { ctx.fillStyle = wall; ctx.fillRect(0, y * TS, TS, TS); ctx.fillRect((GW - 1) * TS, y * TS, TS, TS); }
  ctx.fillStyle = wallTop; for (let x = 0; x < GW; x++) ctx.fillRect(x * TS, 0, TS, 6);
  // janelas na parede de cima com paisagem (céu + colina + árvore)
  [[3, 4], [7, 8], [18, 19], [22, 23]].forEach(([a, b]) => {
    const wx = a * TS + 4, ww = (b - a + 1) * TS - 8, wy = 6, wh = TS - 12;
    ctx.fillStyle = glass; ctx.fillRect(wx, wy, ww, wh);                 // céu
    ctx.fillStyle = '#7ec98f'; ctx.fillRect(wx, wy + wh - 7, ww, 7);     // colina
    ctx.fillStyle = '#fff7c2'; ctx.beginPath(); ctx.arc(wx + ww - 7, wy + 6, 3, 0, Math.PI * 2); ctx.fill(); // sol
    ctx.fillStyle = '#6b4f34'; ctx.fillRect(wx + 9, wy + wh - 12, 2, 8); // tronco
    ctx.fillStyle = '#2faa4c'; ctx.beginPath(); ctx.arc(wx + 10, wy + wh - 13, 5, 0, Math.PI * 2); ctx.fill(); // copa
    // moldura
    ctx.strokeStyle = wallTop; ctx.lineWidth = 2; ctx.strokeRect(wx, wy, ww, wh);
    ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.stroke();
  });
  // rodapé interno
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = 1; x < GW - 1; x++) ctx.fillRect(x * TS, TS - 3, TS, 3);

  // mesa de reunião central
  roundRect(ctx, 11 * TS + 4, 7 * TS + 4, 4 * TS - 8, 2 * TS - 8, 8);
  ctx.fillStyle = '#7a5b3f'; ctx.fill();
  ctx.fillStyle = '#8a6a49'; ctx.fillRect(11 * TS + 10, 7 * TS + 10, 4 * TS - 20, 2 * TS - 20);

  // letreiro com a LOGO na parede de cima (centralizado)
  {
    const fw = 132, fh = 92, fx = (GW * TS - fw) / 2, fy = 3;
    // moldura + fundo
    ctx.fillStyle = '#3a2e22'; roundRect(ctx, fx - 4, fy - 2, fw + 8, fh + 8, 6); ctx.fill();
    ctx.fillStyle = '#ffffff'; roundRect(ctx, fx, fy, fw, fh, 4); ctx.fill();
    if (LOGO_IMG.complete && LOGO_IMG.naturalWidth) {
      // "contain" mantendo proporção dentro da moldura
      const pad = 6, bw = fw - pad * 2, bh = fh - pad * 2;
      const r = Math.min(bw / LOGO_IMG.naturalWidth, bh / LOGO_IMG.naturalHeight);
      const iw = LOGO_IMG.naturalWidth * r, ih = LOGO_IMG.naturalHeight * r;
      ctx.drawImage(LOGO_IMG, fx + (fw - iw) / 2, fy + (fh - ih) / 2, iw, ih);
    }
    // brilho/sombra da moldura
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(fx, fy, fw, fh);
  }

  // rótulos das zonas
  ctx.font = 'bold 10px ui-sans-serif, system-ui'; ctx.textAlign = 'center';
  ZONES.forEach((z) => {
    if (!z.label) return;
    ctx.fillStyle = 'rgba(30,27,22,0.45)';
    ctx.fillText(z.label.toUpperCase(), (z.x + z.w / 2) * TS, z.y * TS + 14);
  });

  // plantas
  PLANTS.forEach(([x, y]) => {
    const cx = x * TS + TS / 2, cy = y * TS + TS / 2;
    ctx.fillStyle = '#8a5a33'; ctx.fillRect(cx - 7, cy + 2, 14, 10);
    ctx.fillStyle = '#2faa4c';
    ctx.beginPath(); ctx.arc(cx, cy - 2, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#22c55e';
    ctx.beginPath(); ctx.arc(cx - 5, cy, 7, 0, Math.PI * 2); ctx.arc(cx + 5, cy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.arc(cx - 3, cy - 5, 3, 0, Math.PI * 2); ctx.fill();
  });
}

function drawFurniture(ctx) {
  for (const f of FURNITURE) {
    const xs = f.tiles.map((t) => t[0]); const ys = f.tiles.map((t) => t[1]);
    const x0 = Math.min(...xs) * TS, y0 = Math.min(...ys) * TS;
    const w = (Math.max(...xs) - Math.min(...xs) + 1) * TS;
    const h = (Math.max(...ys) - Math.min(...ys) + 1) * TS;
    if (f.type === 'bookshelf') {
      ctx.fillStyle = '#6b4f34'; ctx.fillRect(x0 + 2, y0 + 6, w - 4, h - 8);
      for (let i = 0; i < 4; i++) { ctx.fillStyle = ['#ef4444', '#3b82f6', '#eab308', '#10b981'][i % 4]; ctx.fillRect(x0 + 5 + i * ((w - 10) / 4), y0 + 9, (w - 10) / 4 - 2, h - 16); }
    } else if (f.type === 'sofa') {
      ctx.fillStyle = '#475569'; roundRect(ctx, x0 + 3, y0 + 8, w - 6, h - 12, 6); ctx.fill();
      ctx.fillStyle = '#64748b'; roundRect(ctx, x0 + 5, y0 + 6, w - 10, 8, 4); ctx.fill();
    } else if (f.type === 'coffee') {
      ctx.fillStyle = '#7a5b3f'; roundRect(ctx, x0 + 7, y0 + 10, w - 14, h - 18, 4); ctx.fill();
    } else if (f.type === 'counter') {
      ctx.fillStyle = '#94a3b8'; ctx.fillRect(x0 + 4, y0 + 4, w - 8, h - 8);
      ctx.fillStyle = '#cbd5e1'; ctx.fillRect(x0 + 4, y0 + 4, w - 8, 5);
      ctx.fillStyle = '#334155'; ctx.fillRect(x0 + w / 2 - 3, y0 + h / 2, 6, 6); // pia
    } else if (f.type === 'cooler') {
      ctx.fillStyle = '#e2e8f0'; ctx.fillRect(x0 + 9, y0 + 6, w - 18, h - 10);
      ctx.fillStyle = '#38bdf8'; ctx.fillRect(x0 + 11, y0 + 8, w - 22, 8);
    }
  }
}

function drawDesks(ctx, stations, now) {
  stations.forEach((s) => {
    const xs = s.desk.map((d) => d[0]);
    const y = s.desk[0][1];
    const x0 = Math.min(...xs) * TS;
    const w = (Math.max(...xs) - Math.min(...xs) + 1) * TS;
    // cadeira (do lado do assento)
    const seatX = s.seat[0] * TS + TS / 2;
    const chairY = s.face === 'up' ? (y + 1) * TS + 4 : y * TS - 6;
    ctx.fillStyle = '#334155'; roundRect(ctx, seatX - 7, chairY, 14, 12, 4); ctx.fill();
    // tampo da mesa com tom de madeira + borda
    roundRect(ctx, x0 + 3, y * TS + 6, w - 6, TS - 10, 6);
    ctx.fillStyle = '#8a6a49'; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x0 + 5, y * TS + 8, w - 10, 2);
    const my = s.face === 'up' ? y * TS + TS - 13 : y * TS + 3;
    const cx = x0 + w / 2;
    // monitor (com a tela "trabalhando" — linhas de código piscando)
    ctx.fillStyle = '#111827'; ctx.fillRect(cx - 13, my, 14, 10);
    ctx.fillStyle = '#0f2a3a'; ctx.fillRect(cx - 11.5, my + 1.5, 11, 7);
    const blink = Math.floor(now / 400 + cx) % 3;
    ctx.fillStyle = '#38e08a';
    ctx.fillRect(cx - 11, my + 2.5, 4 + blink * 2, 1);
    ctx.fillStyle = '#7dd3fc';
    ctx.fillRect(cx - 11, my + 4.5, 7 - blink, 1);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(cx - 11, my + 6.5, 3 + blink, 1);
    // laptop aberto ao lado
    ctx.fillStyle = '#94a3b8'; ctx.fillRect(cx + 3, my + 5, 12, 5);     // base
    ctx.fillStyle = '#1f2937'; ctx.fillRect(cx + 3, my, 12, 6);          // tampa
    ctx.fillStyle = blink === 0 ? '#a78bfa' : '#818cf8'; ctx.fillRect(cx + 4.5, my + 1, 9, 4); // tela
    // celular + papéis + caneca
    ctx.fillStyle = '#0b1220'; roundRect(ctx, cx + 17, my + 2, 4, 7, 1); ctx.fill();
    ctx.fillStyle = '#22d3ee'; ctx.fillRect(cx + 17.6, my + 2.8, 2.8, 4.5);
    ctx.fillStyle = '#e2e8f0'; ctx.fillRect(cx - 20, my + 3, 6, 7);     // papéis
    ctx.fillStyle = '#cbd5e1'; ctx.fillRect(cx - 19, my + 4, 4, 1);
    ctx.fillStyle = '#ef4444'; ctx.fillRect(cx - 21, my + 1, 4, 4);     // caneca
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line); line = w;
      if (lines.length === maxLines - 1) break;
    } else line = test;
  }
  if (line && lines.length < maxLines) lines.push(line);
  // se sobrou texto, corta com reticências
  const used = lines.join(' ');
  if (used.length < text.length && lines.length) lines[lines.length - 1] += '…';
  return lines;
}

// balão de fala estilo jogo, acima do personagem
function drawSpeechBubble(ctx, cx, topY, text) {
  ctx.font = '9px ui-sans-serif, system-ui';
  const maxW = 130;
  const lines = wrapText(ctx, text, maxW, 3);
  const w = Math.min(maxW + 12, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12);
  const h = lines.length * 12 + 8;
  const x = cx - w / 2, y = topY - h - 6;
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  roundRect(ctx, x, y, w, h, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx - 4, y + h); ctx.lineTo(cx + 4, y + h); ctx.lineTo(cx, y + h + 5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#111827'; ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, cx, y + 14 + i * 12));
}

// desenha a "cabeça" com avatar (imagem) recortado em círculo, ou cor sólida
function drawHead(ctx, x, y, r, img, fallback) {
  if (img && img.complete && img.naturalWidth) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    return true;
  }
  ctx.fillStyle = fallback;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  return false;
}

// corpo de personagem em pixel-art: pernas animadas, braços, corpo e cabeça
function drawCharBody(ctx, x, y, bodyColor, face, animFrame, moving, img) {
  const swing = moving ? Math.sin(animFrame * 0.3) * 2.5 : 0;
  // pernas + sapatos
  ctx.fillStyle = '#3b2f2a';
  ctx.fillRect(x - 5, y + 9, 3, 5 + swing);
  ctx.fillRect(x + 2, y + 9, 3, 5 - swing);
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(x - 6, y + 13 + Math.max(0, swing), 4, 2);
  ctx.fillRect(x + 2, y + 13 + Math.max(0, -swing), 4, 2);
  // braços (atrás do corpo)
  ctx.fillStyle = bodyColor;
  ctx.fillRect(x - 10, y - 2, 3, 9);
  ctx.fillRect(x + 7, y - 2, 3, 9);
  ctx.fillStyle = '#f1d4b3';
  ctx.fillRect(x - 10, y + 6, 3, 3);
  ctx.fillRect(x + 7, y + 6, 3, 3);
  // corpo (camiseta) com sombra lateral
  roundRect(ctx, x - 8, y - 4, 16, 16, 6); ctx.fillStyle = bodyColor; ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; roundRect(ctx, x + 1, y - 4, 7, 16, 6); ctx.fill();
  // cabeça (avatar ou rosto desenhado)
  const hasImg = drawHead(ctx, x, y - 8, 7, img, '#f1d4b3');
  if (!hasImg) {
    // cabelo
    ctx.fillStyle = '#2b2118';
    ctx.beginPath(); ctx.arc(x, y - 9, 7, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - 7, y - 9, 14, 2);
    // olhos conforme direção
    ctx.fillStyle = '#1f2937';
    const eo = { up: [0, -2], down: [0, 1], left: [-2, 0], right: [2, 0] }[face] || [0, 0];
    if (face !== 'up') {
      ctx.beginPath();
      ctx.arc(x - 2.5 + eo[0], y - 6 + eo[1], 1.1, 0, Math.PI * 2);
      ctx.arc(x + 2.5 + eo[0], y - 6 + eo[1], 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// desenha um sprite PNG ancorado pelos pés, com leve "bob" ao andar
function drawSpriteChar(ctx, img, x, footY, moving, animFrame) {
  const h = 34;
  const w = h * (img.naturalWidth / img.naturalHeight || 0.7);
  const step = moving ? Math.abs(Math.sin(animFrame * 0.3)) * 2 : 0;
  ctx.drawImage(img, x - w / 2, footY - h - step, w, h);
}

function drawAgent(ctx, a, now, { selected, img, sprite, near }) {
  const bob = a.moving ? Math.abs(Math.sin(a.animFrame * 0.025)) * 3 : 0;
  const x = a.px, y = a.py - bob;

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(a.px, a.py + 13, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();

  if (selected) {
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(x, y + 2, 17, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  if (a.activeUntil > now) {
    const pulse = 14 + Math.sin(now * 0.006) * 2;
    ctx.strokeStyle = 'rgba(52,211,153,0.9)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y + 2, pulse, 0, Math.PI * 2); ctx.stroke();
  }

  const spriteReady = sprite && sprite.complete && sprite.naturalWidth;
  if (spriteReady) drawSpriteChar(ctx, sprite, x, a.py + 14 - bob, a.moving, a.animFrame);
  else drawCharBody(ctx, x, y, a.color, a.face, a.animFrame, a.moving, img);

  // nome
  ctx.font = 'bold 9px ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  const tw = ctx.measureText(a.name).width + 8;
  ctx.fillStyle = 'rgba(15,18,24,0.85)';
  roundRect(ctx, x - tw / 2, y - 30, tw, 12, 4); ctx.fill();
  ctx.fillStyle = '#e5e7eb'; ctx.fillText(a.name, x, y - 21);

  // balão com TEXTO (fala), senão "digitando", senão ASK de proximidade
  if (a.bubbleText && a.bubbleUntil > now) {
    drawSpeechBubble(ctx, x, y - 32, a.bubbleText);
  } else if (a.activeUntil > now && !a.moving) {
    ctx.fillStyle = '#34d399';
    for (let i = 0; i < 3; i++) {
      const up = Math.sin(now * 0.012 + i) > 0.3 ? -1.5 : 0;
      ctx.beginPath(); ctx.arc(x - 4 + i * 4, y - 36 + up, 1.3, 0, Math.PI * 2); ctx.fill();
    }
  } else if (near) {
    const label = 'ASK ▸ E';
    ctx.font = 'bold 8px ui-sans-serif, system-ui';
    const w = ctx.measureText(label).width + 10;
    const yy = y - 34 + Math.sin(now * 0.006) * 1.5;
    ctx.fillStyle = '#fbbf24';
    roundRect(ctx, x - w / 2, yy, w, 13, 6); ctx.fill();
    ctx.fillStyle = '#1f2937'; ctx.fillText(label, x, yy + 9);
  }
}

// personagem do jogador (você)
function drawPlayer(ctx, p, now, img) {
  const bob = p.moving ? Math.abs(Math.sin(p.animFrame * 0.025)) * 3 : 0;
  const x = p.px, y = p.py - bob;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(p.px, p.py + 13, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  // aura sutil
  ctx.strokeStyle = 'rgba(96,165,250,0.45)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y + 2, 15, 0, Math.PI * 2); ctx.stroke();
  drawCharBody(ctx, x, y, '#2563eb', p.face, p.animFrame, p.moving, img);
  ctx.font = 'bold 9px ui-sans-serif, system-ui'; ctx.textAlign = 'center';
  const tw = ctx.measureText('VOCÊ').width + 8;
  ctx.fillStyle = 'rgba(37,99,235,0.92)';
  roundRect(ctx, x - tw / 2, y - 30, tw, 12, 4); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText('VOCÊ', x, y - 21);
}

export default function Office() {
  const { status } = useStatus();
  const { agents: roster, byKey } = useAgents();
  const canvasRef = useRef(null);
  const statusRef = useRef(null);
  const agentsRef = useRef([]);     // engine agents (hit-test + reação ao chat)
  const selectedRef = useRef(null); // key do agente em chat (realce no mapa)
  const keysRef = useRef(new Set()); // teclas pressionadas
  const playerRef = useRef(null);    // personagem do jogador
  const nearRef = useRef(null);      // key do agente próximo (ref p/ loop)
  const imagesRef = useRef({});      // key -> HTMLImageElement (avatares/rosto)
  const spritesRef = useRef({});     // key -> HTMLImageElement (sprite corpo inteiro)
  const chatOpenRef = useRef(false);

  const [chatAgent, setChatAgent] = useState(null); // agente do banco
  const [nearAgent, setNearAgent] = useState(null); // key do agente próximo (UI)
  const [, setTick] = useState(0); // re-render do relógio/atividade
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 20000); return () => clearInterval(t); }, []);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { selectedRef.current = chatAgent?.key || null; chatOpenRef.current = Boolean(chatAgent); }, [chatAgent]);

  // faz os agentes que responderam reagirem no mapa (anel + balão com texto)
  function reactInOffice(replies) {
    const now = performance.now();
    for (const r of replies || []) {
      const key = typeof r === 'string' ? r : r.agent;
      const eng = agentsRef.current.find((a) => a.name === key);
      if (eng) {
        eng.activeUntil = now + ACTIVE_MS;
        if (r.answer) { eng.bubbleText = r.answer.replace(/\s+/g, ' ').slice(0, 140); eng.bubbleUntil = now + 7000; }
      }
    }
  }

  // abre o chat com o agente próximo (tecla E / botão ASK)
  function askNearest() {
    const k = nearRef.current;
    if (k) { const a = byKey(k); if (a) setChatAgent(a); }
  }
  const askRef = useRef(askNearest);
  askRef.current = askNearest; // mantém a versão atual pro listener de teclado

  // pré-carrega avatares (rosto) e sprites (corpo inteiro) dos agentes
  useEffect(() => {
    const av = {}, sp = {};
    for (const a of roster) {
      if (a.avatar_url) { const img = new Image(); img.src = a.avatar_url; av[a.key] = img; }
      if (a.sprite_url) { const img = new Image(); img.src = a.sprite_url; sp[a.key] = img; }
    }
    imagesRef.current = av;
    spritesRef.current = sp;
  }, [roster]);

  // teclado: WASD/setas movem; E/Enter abre o chat com quem está perto
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT');
    };
    const down = (e) => {
      if (isTyping()) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
        keysRef.current.add(k); e.preventDefault();
      } else if (k === 'e' || k === 'enter') {
        if (!chatOpenRef.current) { askRef.current?.(); e.preventDefault(); }
      }
    };
    const up = (e) => keysRef.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []); // eslint-disable-line

  // --- engine (re-inicia quando a lista de agentes muda) ---
  useEffect(() => {
    if (!roster.length) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = GW * TS * dpr;
    canvas.height = GH * TS * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const stations = roster.map((_, i) => stationFor(i));
    const grid = buildGrid(stations);

    const agents = roster.map((r, i) => {
      const st = stations[i];
      const c = tileCenter({ x: st.seat[0], y: st.seat[1] });
      return {
        name: r.key,                       // chave (status/reação)
        color: hexOf(r.color),
        station: st,
        px: c.x, py: c.y,
        path: null, pathIdx: 0,
        moving: false, face: st.face,
        animFrame: 0,
        seat: { x: st.seat[0], y: st.seat[1] },
        prevQueries: null,
        activeUntil: 0,
        bubbleUntil: 0,
        nextThink: 0
      };
    });
    agentsRef.current = agents;

    // jogador (preserva posição entre re-inits)
    const walkableAtPx = (px, py) => {
      const tx = Math.floor(px / TS), ty = Math.floor(py / TS);
      return grid[ty]?.[tx] === 1;
    };
    if (!playerRef.current) {
      let spawn = { x: 13, y: 10 };
      if (grid[spawn.y]?.[spawn.x] !== 1) spawn = randomFloorTile(grid) || spawn;
      const pc = tileCenter(spawn);
      playerRef.current = { px: pc.x, py: pc.y, face: 'down', moving: false, animFrame: 0 };
    }

    const curTile = (a) => ({ x: Math.round((a.px - TS / 2) / TS), y: Math.round((a.py - TS / 2) / TS) });

    function goTo(a, goal) {
      const p = findPath(grid, curTile(a), goal);
      if (p && p.length > 1) { a.path = p; a.pathIdx = 1; a.moving = true; }
    }

    // tile caminhável ao lado do jogador (pra o agente parar de frente)
    function tileNearPlayer() {
      const p = playerRef.current;
      const pt = { x: Math.round((p.px - TS / 2) / TS), y: Math.round((p.py - TS / 2) / TS) };
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = pt.x + dx, ny = pt.y + dy;
        if (grid[ny]?.[nx] === 1) return { x: nx, y: ny };
      }
      return pt;
    }

    function think(a, now) {
      // chamado no chat → vem até o jogador e fica por perto
      if (a.name === selectedRef.current) {
        const goal = tileNearPlayer();
        const cur = curTile(a);
        if ((Math.abs(cur.x - goal.x) + Math.abs(cur.y - goal.y)) > 0 && !a.moving) goTo(a, goal);
        a.nextThink = now + 500;
        return;
      }
      const atSeat = curTile(a).x === a.seat.x && curTile(a).y === a.seat.y;
      // acabou de responder → fica na mesa "trabalhando" (com bolha)
      if (a.activeUntil > now) {
        if (!atSeat) goTo(a, a.seat);
        a.nextThink = now + 2500 + Math.random() * 2000;
        return;
      }
      // rotina por horário
      const mode = scheduleMode();
      a.mode = mode;
      if (mode === 'meeting') {
        const t = randomTileInRect(grid, ZONE_REUNIAO); if (t) goTo(a, t);
        a.nextThink = now + 4000 + Math.random() * 3000;
      } else if (mode === 'coffee') {
        const t = randomTileInRect(grid, ZONE_COPA); if (t) goTo(a, t);
        a.nextThink = now + 4000 + Math.random() * 3000;
      } else if (mode === 'work') {
        if (!atSeat) goTo(a, a.seat);
        else if (Math.random() < 0.12) { const t = randomFloorTile(grid); if (t) goTo(a, t); } // estica as pernas
        a.nextThink = now + 5000 + Math.random() * 4000;
      } else {
        if (Math.random() < 0.6) { const t = randomFloorTile(grid); if (t) goTo(a, t); } else goTo(a, a.seat);
        a.nextThink = now + 3500 + Math.random() * 4000;
      }
    }

    function syncFromStatus(a, now) {
      const runtime = statusRef.current?.activity?.agents || {};
      const q = runtime[a.name]?.queries ?? 0;
      if (a.prevQueries === null) { a.prevQueries = q; return; }
      if (q > a.prevQueries) {
        a.activeUntil = now + ACTIVE_MS;
        a.bubbleUntil = now + 2500;
        a.nextThink = 0;
      }
      a.prevQueries = q;
    }

    let raf, last = performance.now();
    function loop(now) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      for (const a of agents) {
        syncFromStatus(a, now);
        if (now >= a.nextThink) think(a, now);

        if (a.moving && a.path) {
          const target = tileCenter(a.path[a.pathIdx]);
          const dx = target.x - a.px, dy = target.y - a.py;
          const dist = Math.hypot(dx, dy);
          if (dist < 1.5) {
            a.px = target.x; a.py = target.y;
            a.pathIdx++;
            if (a.pathIdx >= a.path.length) { a.moving = false; a.path = null; }
          } else {
            const step = Math.min(SPEED * dt, dist);
            a.px += (dx / dist) * step;
            a.py += (dy / dist) * step;
            a.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
            a.animFrame += step * 4;
          }
        } else if (!a.moving) {
          if (a.name === selectedRef.current) {
            // de frente pro jogador, dando atenção
            const p = playerRef.current;
            const dx = p.px - a.px, dy = p.py - a.py;
            a.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
          } else if (curTile(a).x === a.seat.x && curTile(a).y === a.seat.y) {
            a.face = a.station.face;
          }
        }
      }

      // --- jogador: movimento por teclado ---
      const player = playerRef.current;
      const K = keysRef.current;
      let mvx = 0, mvy = 0;
      if (K.has('arrowleft') || K.has('a')) mvx -= 1;
      if (K.has('arrowright') || K.has('d')) mvx += 1;
      if (K.has('arrowup') || K.has('w')) mvy -= 1;
      if (K.has('arrowdown') || K.has('s')) mvy += 1;
      player.moving = Boolean(mvx || mvy);
      if (player.moving) {
        const len = Math.hypot(mvx, mvy) || 1;
        const sp = PLAYER_SPEED * dt;
        const nx = player.px + (mvx / len) * sp;
        const ny = player.py + (mvy / len) * sp;
        if (walkableAtPx(nx, player.py)) player.px = nx;
        if (walkableAtPx(player.px, ny)) player.py = ny;
        player.face = Math.abs(mvx) > Math.abs(mvy) ? (mvx > 0 ? 'right' : 'left') : (mvy > 0 ? 'down' : 'up');
        player.animFrame += sp * 4;
      }

      // --- proximidade: agente mais perto do jogador ---
      let near = null, nd = NEAR_DIST;
      for (const a of agents) {
        const d = Math.hypot(a.px - player.px, a.py - player.py);
        if (d < nd) { nd = d; near = a.name; }
      }
      if (near !== nearRef.current) { nearRef.current = near; setNearAgent(near); }

      // --- render (ordenado por Y, jogador incluído) ---
      drawRoom(ctx);
      drawFurniture(ctx);
      drawDesks(ctx, stations, now);
      const sel = selectedRef.current;
      const imgs = imagesRef.current;
      const sprs = spritesRef.current;
      const drawables = agents.map((a) => ({ y: a.py, draw: () => drawAgent(ctx, a, now, { selected: a.name === sel, img: imgs[a.name], sprite: sprs[a.name], near: a.name === near }) }));
      drawables.push({ y: player.py, draw: () => drawPlayer(ctx, player, now, null) });
      drawables.sort((p, q) => p.y - q.y).forEach((d) => d.draw());

      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [roster]);

  // clicar no boneco abre o chat
  function handleCanvasClick(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ix = ((e.clientX - rect.left) / rect.width) * (GW * TS);
    const iy = ((e.clientY - rect.top) / rect.height) * (GH * TS);
    let best = null, bestD = 24; // raio de clique
    for (const a of agentsRef.current) {
      const d = Math.hypot(a.px - ix, a.py - iy);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best) {
      const a = byKey(best.name);
      if (a) setChatAgent(a);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          <kbd className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px]">W A S D</kbd> pra andar ·
          chegue perto e aperte <kbd className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px]">E</kbd> (ou clique) pra conversar — o agente <strong className="text-body">vem até você</strong>.
        </p>
        <span className="flex items-center gap-1.5 rounded-full border border-edge bg-surface px-3 py-1 text-xs">
          🕐 {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          <span className="text-muted">·</span>
          <span className="font-semibold text-emerald-400">{SCHEDULE_LABEL[scheduleMode()]}</span>
        </span>
      </div>

      <div className="relative rounded-xl border border-edge bg-surface p-3">
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          tabIndex={0}
          className="w-full cursor-pointer rounded-lg outline-none"
          style={{ imageRendering: 'pixelated', aspectRatio: `${GW} / ${GH}` }}
        />

        {/* botão ASK quando há um agente próximo e o chat está fechado */}
        {nearAgent && !chatAgent && (
          <button
            onClick={askNearest}
            className="absolute bottom-5 left-1/2 -translate-x-1/2 animate-pulse rounded-full bg-amber-400 px-4 py-2 text-xs font-bold text-slate-900 shadow-lg"
          >
            💬 Falar com {byKey(nearAgent)?.name || nearAgent} (E)
          </button>
        )}

      </div>

      {/* painel de chat — EMBAIXO do mapa */}
      {chatAgent && (
        <div className="flex h-[400px] flex-col overflow-hidden rounded-xl border border-edge bg-surface">
          <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
            {chatAgent.avatar_url ? (
              <img src={chatAgent.avatar_url} alt={chatAgent.name} className="h-9 w-9 shrink-0 rounded-full object-cover" />
            ) : (
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
                style={{ background: hexOf(chatAgent.color) }}
              >
                {chatAgent.name}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{chatAgent.name} <span className="text-[11px] font-normal text-emerald-400">• veio falar com você</span></p>
              <p className="truncate text-[11px] text-muted">{chatAgent.role} · {chatAgent.model}</p>
            </div>
            <button onClick={() => setChatAgent(null)} className="rounded p-1 text-muted hover:bg-white/10 hover:text-body">
              <X size={16} />
            </button>
          </div>
          <AgentChat agent={chatAgent} onReply={reactInOffice} className="min-h-0 flex-1" />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {roster.map((a) => {
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
