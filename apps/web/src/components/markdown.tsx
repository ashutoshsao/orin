import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// The agent writes markdown ("**Features**", bullet lists, `code`). Rendering it as raw
// text was the most visible rough edge in the feed. Elements are mapped explicitly
// rather than using a prose plugin so the output stays in the sidebar's type scale.
export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed [&>*+*]:mt-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{children}</p>,
          strong: ({ children }) => <strong className="font-medium">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-4 marker:text-muted-foreground">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-4 marker:text-muted-foreground">{children}</ol>,
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          h1: ({ children }) => <h3 className="font-medium">{children}</h3>,
          h2: ({ children }) => <h3 className="font-medium">{children}</h3>,
          h3: ({ children }) => <h3 className="font-medium">{children}</h3>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:no-underline">
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            // Fenced blocks arrive with a language class; inline code has none.
            const fenced = Boolean(className)
            return fenced
              ? <code className="font-mono text-xs">{children}</code>
              : <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em]">{children}</code>
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3">{children}</pre>
          ),
          hr: () => <hr className="border-border" />,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 pl-3 text-muted-foreground">{children}</blockquote>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
