import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, ExternalLink, ImageOff, Maximize2, X } from 'lucide-react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/utils';

type MarkdownContentProps = {
  content: string;
  className?: string;
};

function safeUrlTransform(url: string): string {
  const transformed = defaultUrlTransform(url);
  if (!transformed) return '';
  if (transformed.startsWith('/') || transformed.startsWith('#')) return transformed;

  try {
    const parsed = new URL(transformed);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? transformed : '';
  } catch {
    return '';
  }
}

function safeImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? url : '';
  } catch {
    return url.startsWith('/') ? url : '';
  }
}

export function RichImage({ src: rawSrc, alt = '', title }: ComponentPropsWithoutRef<'img'>) {
  const src = safeImageUrl(rawSrc || '');
  const [isOpen, setIsOpen] = useState(false);
  const [hasError, setHasError] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!src || hasError) {
    return (
      <div className="flex min-h-32 items-center justify-center gap-2 rounded-xl border border-current/15 bg-black/10 px-4 text-sm opacity-70" role="status">
        <ImageOff className="h-4 w-4" aria-hidden="true" />
        <span>{alt || 'Image unavailable'}</span>
      </div>
    );
  }

  return (
    <figure className="group/image my-4 overflow-hidden rounded-xl border border-current/15 bg-black/10">
      <button
        type="button"
        className="relative block w-full cursor-zoom-in overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        onClick={() => setIsOpen(true)}
        aria-label={`Open image preview${alt ? `: ${alt}` : ''}`}
      >
        <img
          src={src}
          alt={alt}
          title={title}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setHasError(true)}
          className="max-h-[36rem] w-full bg-black/10 object-contain"
        />
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-slate-950/80 px-2 py-1 text-[11px] text-white opacity-0 shadow transition-opacity group-hover/image:opacity-100 group-focus-within/image:opacity-100">
          <Maximize2 className="h-3 w-3" aria-hidden="true" /> Preview
        </span>
      </button>
      {(title || alt) && (
        <figcaption className="border-t border-current/10 px-3 py-2 text-xs opacity-65">
          {title || alt}
        </figcaption>
      )}
      {isOpen && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/95 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={alt || 'Image preview'}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setIsOpen(false);
          }}
        >
          <img src={src} alt={alt} className="max-h-[90vh] max-w-[94vw] object-contain" />
          <div className="absolute right-4 top-4 flex items-center gap-2">
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-white/20 bg-slate-900 px-4 text-sm text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" /> Open original
            </a>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setIsOpen(false)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              aria-label="Close image preview"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>,
        document.body
      )}
    </figure>
  );
}

function RichTable({ children, ...props }: ComponentPropsWithoutRef<'table'>) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [copied, setCopied] = useState(false);

  const copyTable = async () => {
    const rows = Array.from(tableRef.current?.rows || []);
    const text = rows
      .map((row) => Array.from(row.cells).map((cell) => cell.innerText.trim()).join('\t'))
      .join('\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="my-4 min-w-0 overflow-hidden rounded-xl border border-current/15 bg-black/10">
      <div className="flex items-center justify-between border-b border-current/10 px-3 py-2 text-xs">
        <span className="font-medium opacity-65">Table</span>
        <button
          type="button"
          onClick={() => void copyTable()}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 opacity-65 hover:bg-current/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="max-w-full overflow-x-auto overscroll-x-contain" tabIndex={0} aria-label="Scrollable table">
        <table ref={tableRef} {...props} className="w-max min-w-full border-collapse text-left text-sm">
          {children}
        </table>
      </div>
    </div>
  );
}

function RichPre({ children }: ComponentPropsWithoutRef<'pre'>) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    const text = preRef.current?.innerText || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="group/code relative my-3 max-w-full">
      <button
        type="button"
        onClick={() => void copyCode()}
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-slate-900/90 px-2 py-1 text-[11px] text-slate-300 opacity-0 shadow transition-opacity hover:text-white group-hover/code:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy code'}
      </button>
      <pre ref={preRef} className="max-w-full overflow-x-auto rounded-xl border border-current/15 bg-slate-950 p-4 pr-20 text-xs leading-6 text-slate-100">
        {children}
      </pre>
    </div>
  );
}

function flattenText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(flattenText).join('');
  return '';
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn('rich-message min-w-0 text-sm leading-7', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeUrlTransform}
        components={{
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          h1: ({ children }) => <h1 className="mb-2 mt-5 text-xl font-semibold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-5 text-lg font-semibold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:opacity-60">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:opacity-60">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-cyan-400/60 pl-4 italic opacity-80">{children}</blockquote>,
          hr: () => <hr className="my-4 border-current/15" />,
          a: ({ href = '', children }) => (
            <a
              href={href}
              target={href.startsWith('#') ? undefined : '_blank'}
              rel="noopener noreferrer"
              className="break-words font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current"
            >
              {children}
              {!href.startsWith('#') && <ExternalLink className="ml-1 inline h-3 w-3" aria-hidden="true" />}
            </a>
          ),
          img: RichImage,
          table: RichTable,
          thead: ({ children }) => <thead className="sticky top-0 z-10 bg-slate-800 text-slate-100">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-current/10">{children}</tbody>,
          tr: ({ children }) => <tr className="transition-colors hover:bg-current/[0.04]">{children}</tr>,
          th: ({ children }) => <th scope="col" className="whitespace-nowrap border-b border-current/15 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider opacity-75">{children}</th>,
          td: ({ children }) => <td className="max-w-80 px-3 py-2.5 align-top leading-5">{children}</td>,
          pre: RichPre,
          code: ({ className: codeClassName, children }) => {
            const isBlock = Boolean(codeClassName) || flattenText(children).includes('\n');
            return (
              <code className={cn(isBlock ? codeClassName : 'rounded bg-current/10 px-1.5 py-0.5 font-mono text-[0.9em]')}>
                {children}
              </code>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
