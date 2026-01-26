export type A2UIComponentType = 'Card' | 'Text' | 'Button' | 'Input' | 'Select' | 'Form';

export type A2UIElement = {
  type: A2UIComponentType;
  props?: Record<string, any>;
  children?: A2UIElement[];
};

export type A2UIPayload = {
  a2ui: {
    version: '0.8';
    ui: A2UIElement | A2UIElement[];
  };
  fallback_text?: string;
};

export type ParsedA2UI = {
  ui: A2UIElement | A2UIElement[];
  fallbackText: string | null;
};

export type A2UIEvent = {
  type: 'button' | 'form';
  id?: string | null;
  action?: string | null;
  label?: string | null;
  fields?: Record<string, any> | null;
};

const ALLOWED_COMPONENTS = new Set<A2UIComponentType>([
  'Card',
  'Text',
  'Button',
  'Input',
  'Select',
  'Form'
]);

const EVENT_PREFIX = 'A2UI_EVENT ';

function isPlainObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i) || trimmed.match(/```\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

function normalizeNode(node: any): A2UIElement | null {
  if (!isPlainObject(node)) return null;
  const nodeKeys = Object.keys(node);
  if (nodeKeys.length === 1 && ALLOWED_COMPONENTS.has(nodeKeys[0] as A2UIComponentType)) {
    const nested = node[nodeKeys[0]];
    if (typeof nested === 'string') {
      return normalizeNode({
        type: nodeKeys[0],
        text: nested
      });
    }
    return normalizeNode({
      type: nodeKeys[0],
      ...(isPlainObject(nested) ? nested : {})
    });
  }
  const rawType = node.type;
  if (typeof rawType !== 'string' || !ALLOWED_COMPONENTS.has(rawType as A2UIComponentType)) {
    return null;
  }
  const normalized: A2UIElement = {
    type: rawType as A2UIComponentType,
    props: isPlainObject(node.props) ? { ...node.props } : {},
    children: Array.isArray(node.children) ? [] : undefined
  };

  if (typeof node.text === 'string' && normalized.props) {
    normalized.props.text = node.text;
  }
  if (typeof node.label === 'string' && normalized.props) {
    normalized.props.label = node.label;
  }
  if (typeof node.title === 'string' && normalized.props) {
    normalized.props.title = node.title;
  }

  if (Array.isArray(node.children)) {
    const normalizedChildren = node.children.map(normalizeNode).filter(Boolean) as A2UIElement[];
    if (normalizedChildren.length !== node.children.length) {
      return null;
    }
    normalized.children = normalizedChildren;
  }
  if (!normalized.children && Array.isArray(node.contents)) {
    const normalizedContents = node.contents.map(normalizeNode).filter(Boolean) as A2UIElement[];
    if (normalizedContents.length !== node.contents.length) {
      return null;
    }
    normalized.children = normalizedContents;
  }

  return normalized;
}

function validateNode(node: any): node is A2UIElement {
  return Boolean(normalizeNode(node));
}

function normalizeUi(ui: any): A2UIElement | A2UIElement[] | null {
  if (Array.isArray(ui)) {
    const normalized = ui.map(normalizeNode).filter(Boolean) as A2UIElement[];
    return normalized.length === ui.length && normalized.length > 0 ? normalized : null;
  }
  if (isPlainObject(ui)) {
    const uiKeys = Object.keys(ui);
    if (uiKeys.length === 1 && ALLOWED_COMPONENTS.has(uiKeys[0] as A2UIComponentType)) {
      const keyedNode = ui[uiKeys[0]];
      const normalizedChild = normalizeNode({
        type: uiKeys[0],
        ...(isPlainObject(keyedNode) ? keyedNode : {})
      });
      return normalizedChild ?? null;
    }
  }
  if (isPlainObject(ui) && isPlainObject((ui as any).card)) {
    const cardNode = (ui as any).card;
    const normalizedChild = normalizeNode(cardNode);
    if (!normalizedChild) return null;
    return {
      type: 'Card',
      props: {},
      children: [normalizedChild]
    };
  }
  return normalizeNode(ui);
}

function validateUi(ui: any): ui is A2UIElement | A2UIElement[] {
  return Boolean(normalizeUi(ui));
}

export function parseA2UIPayload(text: string): ParsedA2UI | null {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) return null;
  const a2uiContainer = isPlainObject(parsed.a2ui) ? parsed.a2ui : parsed;
  const version = (a2uiContainer as any)?.version || (parsed as any)['a2ui.version'];
  const uiValue = (a2uiContainer as any)?.ui || (parsed as any)?.ui;
  if (version !== '0.8') return null;
  const normalizedUi = normalizeUi(uiValue);
  if (!normalizedUi) return null;

  return {
    ui: normalizedUi,
    fallbackText: typeof parsed.fallback_text === 'string' ? parsed.fallback_text : null
  };
}

export function formatA2UIEventMessage(event: A2UIEvent): string {
  return `${EVENT_PREFIX}${JSON.stringify(event)}`;
}

export function parseA2UIEventMessage(text: string): A2UIEvent | null {
  if (!text.startsWith(EVENT_PREFIX)) return null;
  const raw = text.slice(EVENT_PREFIX.length).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.type !== 'button' && parsed.type !== 'form') return null;
    return parsed as A2UIEvent;
  } catch {
    return null;
  }
}

export function getA2UIEventDisplay(text: string): string | null {
  const event = parseA2UIEventMessage(text);
  if (!event) return null;
  if (event.type === 'button') {
    return event.label || event.action || event.id || 'Button action';
  }
  if (event.type === 'form') {
    return event.id || 'Form submitted';
  }
  return null;
}
