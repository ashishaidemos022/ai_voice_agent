import { Fragment } from 'react';
import { cn } from '../../lib/utils';

type MarkdownContentProps = {
  content: string;
  className?: string;
};

type Segment =
  | { type: 'text'; value: string }
  | { type: 'image'; alt: string; src: string }
  | { type: 'link'; text: string; href: string };

const IMAGE_PATTERN = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function parseInlineMarkdown(content: string): Segment[] {
  const segments: Segment[] = [];
  const combinedPattern = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let lastIndex = 0;

  for (const match of content.matchAll(combinedPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, index) });
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      segments.push({ type: 'image', alt: match[1], src: match[2] });
    } else if (match[3] !== undefined && match[4] !== undefined) {
      segments.push({ type: 'link', text: match[3], href: match[4] });
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) });
  }

  if (!segments.length) {
    segments.push({ type: 'text', value: content });
  }

  return segments;
}

function renderTextWithBreaks(text: string, keyPrefix: string) {
  return text.split('\n').map((line, index, lines) => (
    <Fragment key={`${keyPrefix}-${index}`}>
      {line}
      {index < lines.length - 1 ? <br /> : null}
    </Fragment>
  ));
}

export function containsMarkdownMedia(content: string): boolean {
  IMAGE_PATTERN.lastIndex = 0;
  LINK_PATTERN.lastIndex = 0;
  return IMAGE_PATTERN.test(content) || LINK_PATTERN.test(content);
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const segments = parseInlineMarkdown(content);

  return (
    <div className={cn('space-y-3 text-sm leading-relaxed', className)}>
      {segments.map((segment, index) => {
        if (segment.type === 'image') {
          return (
            <img
              key={`img-${index}`}
              src={segment.src}
              alt={segment.alt || 'Embedded content'}
              className="max-h-72 w-full rounded-xl object-cover border border-black/10"
              loading="lazy"
            />
          );
        }

        if (segment.type === 'link') {
          return (
            <a
              key={`link-${index}`}
              href={segment.href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 break-all"
            >
              {segment.text}
            </a>
          );
        }

        if (!segment.value.trim()) {
          return (
            <div key={`text-${index}`} className="whitespace-pre-wrap">
              {renderTextWithBreaks(segment.value, `text-${index}`)}
            </div>
          );
        }

        return (
          <div key={`text-${index}`} className="whitespace-pre-wrap">
            {renderTextWithBreaks(segment.value, `text-${index}`)}
          </div>
        );
      })}
    </div>
  );
}
