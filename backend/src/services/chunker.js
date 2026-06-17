// Aproximação padrão da indústria: ~4 caracteres por token.
const CHARS_PER_TOKEN = 4;

/**
 * Divide texto em chunks com overlap, tentando quebrar em limites
 * naturais (parágrafo > linha > frase) perto do fim de cada janela.
 *
 * @param {string} text
 * @param {{ chunkSize?: number, overlap?: number, unit?: 'tokens'|'chars' }} opts
 * @returns {string[]}
 */
export function chunkText(text, { chunkSize = 512, overlap = 64, unit = 'tokens' } = {}) {
  const sizeChars = unit === 'tokens' ? chunkSize * CHARS_PER_TOKEN : chunkSize;
  const overlapChars = unit === 'tokens' ? overlap * CHARS_PER_TOKEN : overlap;

  if (sizeChars <= 0) throw new Error('chunk_size deve ser maior que zero');
  if (overlapChars >= sizeChars) throw new Error('overlap deve ser menor que o chunk_size');

  const clean = String(text).replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= sizeChars) return [clean];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + sizeChars, clean.length);

    if (end < clean.length) {
      const slice = clean.slice(start, end);
      const breakAt = Math.max(
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('\n'),
        slice.lastIndexOf('. ')
      );
      // só usa a quebra natural se ela não encurtar demais o chunk
      if (breakAt > sizeChars * 0.5) end = start + breakAt + 1;
    }

    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);

    if (end >= clean.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks;
}
