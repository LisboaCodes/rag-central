import { createWorker } from 'tesseract.js';

// OCR para extrair texto de prints/screenshots. Worker é criado sob demanda
// e reaproveitado (o primeiro uso baixa os modelos por+eng — pode demorar).
let workerPromise = null;

function getWorker() {
  if (!workerPromise) workerPromise = createWorker('por+eng');
  return workerPromise;
}

// recebe um Buffer de imagem e devolve o texto reconhecido (ou '')
export async function ocrImage(buffer) {
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(buffer);
    return (data?.text || '').trim();
  } catch {
    return '';
  }
}
