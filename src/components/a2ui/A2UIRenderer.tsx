import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import type { A2UIElement, A2UIEvent } from '../../lib/a2ui';

const FormContext = createContext<{
  values: Record<string, any>;
  setValue: (key: string, value: any) => void;
} | null>(null);

type A2UIRendererProps = {
  ui: A2UIElement | A2UIElement[];
  fallbackText?: string | null;
  onEvent?: (event: A2UIEvent) => void;
  className?: string;
};

function A2UIText({ node }: { node: A2UIElement }) {
  const text = typeof node.props?.text === 'string'
    ? node.props.text
    : typeof node.props?.value === 'string'
    ? node.props.value
    : '';
  return <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>;
}

function A2UIButton({ node, onEvent }: { node: A2UIElement; onEvent?: (event: A2UIEvent) => void }) {
  const label = typeof node.props?.label === 'string'
    ? node.props.label
    : typeof node.props?.text === 'string'
    ? node.props.text
    : 'Action';
  const action = typeof node.props?.action === 'string' ? node.props.action : null;
  const id = typeof node.props?.id === 'string' ? node.props.id : null;
  return (
    <Button
      size="sm"
      onClick={() =>
        onEvent?.({
          type: 'button',
          id,
          action,
          label
        })
      }
    >
      {label}
    </Button>
  );
}

function A2UIInput({ node }: { node: A2UIElement }) {
  const form = useContext(FormContext);
  const name =
    (typeof node.props?.name === 'string' && node.props.name) ||
    (typeof node.props?.id === 'string' && node.props.id) ||
    (typeof node.props?.label === 'string' && node.props.label) ||
    'input';
  const label = typeof node.props?.label === 'string' ? node.props.label : null;
  const placeholder = typeof node.props?.placeholder === 'string' ? node.props.placeholder : '';
  const type = typeof node.props?.input_type === 'string' ? node.props.input_type : 'text';
  const value = form ? form.values[name] ?? '' : '';
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label && <span className="text-xs uppercase tracking-[0.2em] opacity-60">{label}</span>}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => form?.setValue(name, event.target.value)}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-current placeholder:text-current placeholder:opacity-50"
      />
    </label>
  );
}

function A2UISelect({ node }: { node: A2UIElement }) {
  const form = useContext(FormContext);
  const name =
    (typeof node.props?.name === 'string' && node.props.name) ||
    (typeof node.props?.id === 'string' && node.props.id) ||
    (typeof node.props?.label === 'string' && node.props.label) ||
    'select';
  const label = typeof node.props?.label === 'string' ? node.props.label : null;
  const options = Array.isArray(node.props?.options) ? node.props.options : [];
  const value = form ? form.values[name] ?? '' : '';
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label && <span className="text-xs uppercase tracking-[0.2em] opacity-60">{label}</span>}
      <select
        value={value}
        onChange={(event) => form?.setValue(name, event.target.value)}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-current"
      >
        <option value="">Select…</option>
        {options.map((option: any, idx: number) => {
          if (typeof option === 'string') {
            return (
              <option key={`${option}-${idx}`} value={option}>
                {option}
              </option>
            );
          }
          const optValue = typeof option?.value === 'string' ? option.value : String(option?.value ?? '');
          const optLabel = typeof option?.label === 'string' ? option.label : optValue || `Option ${idx + 1}`;
          return (
            <option key={`${optValue}-${idx}`} value={optValue}>
              {optLabel}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function A2UICard({ node, children }: { node: A2UIElement; children: ReactNode }) {
  const title = typeof node.props?.title === 'string' ? node.props.title : null;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
      {title && <p className="text-xs uppercase tracking-[0.3em] text-current opacity-60">{title}</p>}
      {children}
    </div>
  );
}

function A2UIForm({ node, onEvent, renderChildren }: {
  node: A2UIElement;
  onEvent?: (event: A2UIEvent) => void;
  renderChildren: (children?: A2UIElement[]) => ReactNode;
}) {
  const [values, setValues] = useState<Record<string, any>>({});
  const id = typeof node.props?.id === 'string' ? node.props.id : null;
  const title = typeof node.props?.title === 'string' ? node.props.title : null;
  const submitLabel = typeof node.props?.submit_label === 'string' ? node.props.submit_label : 'Submit';

  const contextValue = useMemo(() => ({
    values,
    setValue: (key: string, value: any) => setValues((prev) => ({ ...prev, [key]: value }))
  }), [values]);

  return (
    <FormContext.Provider value={contextValue}>
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        {title && <p className="text-xs uppercase tracking-[0.3em] text-current opacity-60">{title}</p>}
        {renderChildren(node.children)}
        <div>
          <Button
            size="sm"
            onClick={() =>
              onEvent?.({
                type: 'form',
                id,
                fields: values
              })
            }
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    </FormContext.Provider>
  );
}

export function A2UIRenderer({ ui, fallbackText, onEvent, className }: A2UIRendererProps) {
  const nodes = Array.isArray(ui) ? ui : [ui];

  const renderNode = (node: A2UIElement, key: string): ReactNode => {
    switch (node.type) {
      case 'Card':
        return (
          <A2UICard key={key} node={node}>
            {renderChildren(node.children)}
          </A2UICard>
        );
      case 'Text':
        return <A2UIText key={key} node={node} />;
      case 'Button':
        return <A2UIButton key={key} node={node} onEvent={onEvent} />;
      case 'Input':
        return <A2UIInput key={key} node={node} />;
      case 'Select':
        return <A2UISelect key={key} node={node} />;
      case 'Form':
        return (
          <A2UIForm
            key={key}
            node={node}
            onEvent={onEvent}
            renderChildren={renderChildren}
          />
        );
      default:
        return null;
    }
  };

  const renderChildren = (children?: A2UIElement[]) => {
    if (!children || children.length === 0) return null;
    return (
      <div className="space-y-3">
        {children.map((child, idx) => renderNode(child, `${child.type}-${idx}`))}
      </div>
    );
  };

  try {
    return (
      <div className={className || 'space-y-3'}>
        {nodes.map((node, idx) => renderNode(node, `${node.type}-${idx}`))}
        {!nodes.length && fallbackText && <p className="text-sm whitespace-pre-wrap">{fallbackText}</p>}
      </div>
    );
  } catch (error) {
    if (fallbackText) {
      return <p className="text-sm whitespace-pre-wrap">{fallbackText}</p>;
    }
    return null;
  }
}
