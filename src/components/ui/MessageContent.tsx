import { A2UIRenderer } from '../a2ui/A2UIRenderer';
import {
  getA2UIEventDisplay,
  parseA2UIPayload,
  type A2UIEvent
} from '../../lib/a2ui';
import { MarkdownContent } from './MarkdownContent';
import { cn } from '../../lib/utils';
import type { RichMessageContent } from '../../types/chat';

type MessageContentProps = {
  content: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  a2uiEnabled?: boolean;
  onA2UIEvent?: (event: A2UIEvent) => void;
  className?: string;
  richContent?: RichMessageContent;
};

function escapeTableCell(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' / ');
}

function renderStructuredContent(
  content: RichMessageContent,
  onA2UIEvent?: (event: A2UIEvent) => void
) {
  return content.parts.map((part, index) => {
    if (part.type === 'text') {
      return part.format === 'plain'
        ? <p key={index} className="whitespace-pre-wrap text-sm leading-relaxed">{part.text}</p>
        : <MarkdownContent key={index} content={part.text} />;
    }
    if (part.type === 'image') {
      const alt = part.alt.replace(/\]/g, '\\]');
      const caption = part.caption ? `\n\n*${part.caption}*` : '';
      return <MarkdownContent key={index} content={`![${alt}](${part.url})${caption}`} />;
    }
    if (part.type === 'table') {
      const header = `| ${part.columns.map((column) => escapeTableCell(column.label)).join(' | ')} |`;
      const divider = `| ${part.columns.map((column) => column.align === 'right' ? '---:' : column.align === 'center' ? ':---:' : '---').join(' | ')} |`;
      const rows = part.rows.map((row) => `| ${part.columns.map((column) => escapeTableCell(row[column.key])).join(' | ')} |`).join('\n');
      const caption = part.caption ? `**${part.caption}**\n\n` : '';
      return <MarkdownContent key={index} content={`${caption}${header}\n${divider}\n${rows}`} />;
    }
    return (
      <A2UIRenderer
        key={index}
        ui={part.payload as never}
        fallbackText="Interactive content"
        onEvent={onA2UIEvent}
      />
    );
  });
}

export function MessageContent({
  content,
  role,
  a2uiEnabled = false,
  onA2UIEvent,
  className,
  richContent
}: MessageContentProps) {
  const isUser = role === 'user';
  const parsedA2UI = !isUser ? parseA2UIPayload(content) : null;
  const eventDisplay = isUser ? getA2UIEventDisplay(content) : null;
  const displayText = eventDisplay ? `Action: ${eventDisplay}` : parsedA2UI?.fallbackText || content;

  if (!isUser && richContent?.version === 1 && richContent.parts.length > 0) {
    return <div className={cn('min-w-0 space-y-3', className)}>{renderStructuredContent(richContent, onA2UIEvent)}</div>;
  }

  if (!isUser && a2uiEnabled && parsedA2UI?.ui) {
    return (
      <A2UIRenderer
        ui={parsedA2UI.ui}
        fallbackText={parsedA2UI.fallbackText || content}
        onEvent={onA2UIEvent}
        className={className}
      />
    );
  }

  if (isUser) {
    return <p className={cn('whitespace-pre-wrap text-sm leading-relaxed', className)}>{displayText}</p>;
  }

  return <MarkdownContent content={displayText} className={className} />;
}
