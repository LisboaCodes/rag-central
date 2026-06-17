import DonutChart from './FileTypeChart.jsx';

// Donut dos modelos de embedding — mesma base do FileTypeChart,
// com legenda em fonte mono (nomes de modelo).
export default function EmbeddingChart({ data }) {
  return <DonutChart data={data} mono />;
}
