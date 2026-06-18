import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Renderiza Markdown das respostas: negrito, itálico, listas, código, tabelas,
// e LINKS clicáveis (abrem em nova aba). remark-gfm também autolinka URLs cruas.
const components = {
  a: ({ node, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer" className="font-medium text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-300" />
  ),
  p: ({ node, ...props }) => <p {...props} className="my-1 leading-relaxed first:mt-0 last:mb-0" />,
  ul: ({ node, ...props }) => <ul {...props} className="my-1 list-disc space-y-0.5 pl-4" />,
  ol: ({ node, ...props }) => <ol {...props} className="my-1 list-decimal space-y-0.5 pl-4" />,
  li: ({ node, ...props }) => <li {...props} className="leading-relaxed" />,
  strong: ({ node, ...props }) => <strong {...props} className="font-bold" />,
  em: ({ node, ...props }) => <em {...props} className="italic" />,
  code: ({ node, inline, ...props }) => inline
    ? <code {...props} className="rounded bg-black/25 px-1 py-0.5 text-[0.85em]" />
    : <code {...props} className="block overflow-x-auto rounded-lg bg-black/30 p-2 text-[0.85em]" />,
  pre: ({ node, ...props }) => <pre {...props} className="my-1.5 overflow-x-auto" />,
  h1: ({ node, ...props }) => <h1 {...props} className="mb-1 mt-2 text-base font-bold first:mt-0" />,
  h2: ({ node, ...props }) => <h2 {...props} className="mb-1 mt-2 text-sm font-bold first:mt-0" />,
  h3: ({ node, ...props }) => <h3 {...props} className="mb-0.5 mt-1.5 text-sm font-semibold first:mt-0" />,
  blockquote: ({ node, ...props }) => <blockquote {...props} className="my-1 border-l-2 border-edge pl-2 text-body/80 italic" />,
  table: ({ node, ...props }) => <table {...props} className="my-1.5 w-full border-collapse text-[0.85em]" />,
  th: ({ node, ...props }) => <th {...props} className="border border-edge px-2 py-1 text-left font-semibold" />,
  td: ({ node, ...props }) => <td {...props} className="border border-edge px-2 py-1" />,
  hr: () => <hr className="my-2 border-edge" />,
  a11yEmoji: undefined
};

export default function Markdown({ children }) {
  return (
    <div className="break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children || ''}
      </ReactMarkdown>
    </div>
  );
}
