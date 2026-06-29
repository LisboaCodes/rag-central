// Fusão e filtragem de candidatos da busca HÍBRIDA (vetorial + palavra-chave).
//
// Usa RRF (Reciprocal Rank Fusion): combina várias listas ranqueadas somando
// 1/(k + posição) de cada item. É robusto porque trabalha com a POSIÇÃO em
// cada lista, não com os scores brutos (que não são comparáveis entre busca
// vetorial e full-text). Lógica pura, sem I/O — testável isoladamente.

const RRF_K = 60;

/**
 * Funde N listas ranqueadas num único ranking por RRF.
 * @param {Array<Array<object>>} lists  listas já ordenadas (melhor primeiro)
 * @param {{ key?: string, k?: number }} opts  key = campo identificador (default 'id')
 * @returns {object[]} itens únicos ordenados por score RRF desc (com campo .rrf)
 */
export function rrfFuse(lists, { key = 'id', k = RRF_K } = {}) {
  const score = new Map();
  const item = new Map();
  for (const list of lists || []) {
    (list || []).forEach((row, rank) => {
      const id = row?.[key];
      if (id == null) return;
      score.set(id, (score.get(id) || 0) + 1 / (k + rank + 1));
      // mantém a linha mais "rica": a que tem similarity (veio do vetorial)
      // ganha da que só veio do keyword, pra preservar o score de cosseno.
      const prev = item.get(id);
      if (!prev || (prev.similarity == null && row.similarity != null)) item.set(id, row);
    });
  }
  return [...item.values()]
    .map((row) => ({ ...row, rrf: score.get(row[key]) }))
    .sort((a, b) => b.rrf - a.rrf);
}

/**
 * Corta candidatos vetoriais fracos (similaridade de cosseno < minSim).
 * Itens que vieram SÓ da busca por palavra-chave (similarity == null) são
 * mantidos — casar um termo exato já é sinal forte por si só.
 */
export function applyThreshold(rows, minSim) {
  if (!minSim) return rows || [];
  return (rows || []).filter((r) => r.similarity == null || r.similarity >= minSim);
}

/**
 * Dedup por (source_path, chunk_index) preservando a ordem — defensivo, caso
 * a mesma fonte apareça em mais de uma lista com ids diferentes.
 */
export function dedupeChunks(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const sig = `${r.source_path}#${r.chunk_index}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(r);
  }
  return out;
}
