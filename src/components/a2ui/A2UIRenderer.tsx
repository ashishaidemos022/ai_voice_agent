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

function resolveTextRole(node: A2UIElement): string | null {
  return typeof node.props?.role === 'string' ? node.props.role : null;
}

function A2UIText({ node }: { node: A2UIElement }) {
  const text = typeof node.props?.text === 'string'
    ? node.props.text
    : typeof node.props?.value === 'string'
    ? node.props.value
    : '';
  const role = resolveTextRole(node);
  if (role === 'divider') {
    return <div className="a2ui-divider" />;
  }
  const variant = typeof node.props?.variant === 'string' ? node.props.variant : 'body';
  const roleClass =
    role === 'eyebrow'
      ? 'a2ui-text--eyebrow'
      : role === 'title'
      ? 'a2ui-text--title'
      : role === 'primary'
      ? 'a2ui-text--primary'
      : role === 'label'
      ? 'a2ui-text--label'
      : role === 'value'
      ? 'a2ui-text--value'
      : role === 'body'
      ? 'a2ui-text--body'
      : null;
  const classes = roleClass
    ? roleClass
    : variant === 'label'
    ? 'text-[11px] uppercase tracking-[0.3em] opacity-60'
    : variant === 'value'
    ? 'text-lg font-semibold'
    : 'text-sm leading-relaxed';
  return <p className={`${classes} whitespace-pre-wrap`}>{text}</p>;
}

function A2UIButton({ node, onEvent }: { node: A2UIElement; onEvent?: (event: A2UIEvent) => void }) {
  const label = typeof node.props?.label === 'string'
    ? node.props.label
    : typeof node.props?.text === 'string'
    ? node.props.text
    : 'Action';
  const action = typeof node.props?.action === 'string'
    ? node.props.action
    : typeof node.props?.action_id === 'string'
    ? node.props.action_id
    : null;
  const id = typeof node.props?.id === 'string'
    ? node.props.id
    : typeof node.props?.component_id === 'string'
    ? node.props.component_id
    : null;
  const variant = typeof node.props?.variant === 'string' ? node.props.variant : 'primary';
  const className = variant === 'secondary'
    ? 'a2ui-button a2ui-button--secondary'
    : 'a2ui-button a2ui-button--primary';
  return (
    <Button
      size="sm"
      className={className}
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
  const subtitle = typeof node.props?.subtitle === 'string' ? node.props.subtitle : null;
  const meta = typeof node.props?.meta === 'string' ? node.props.meta : null;
  const badgeItems = Array.isArray(node.props?.badges) ? node.props.badges : [];
  const accentColor = typeof node.props?.accent_color === 'string' ? node.props.accent_color : null;
  const icon = typeof node.props?.icon === 'string' ? node.props.icon : '🕒';
  const variant = typeof node.props?.variant === 'string' ? node.props.variant : 'default';

  const cardStyle = accentColor ? { borderColor: accentColor, boxShadow: `0 0 0 1px ${accentColor}33` } : undefined;
  const headerStyle = accentColor ? { color: accentColor } : undefined;
  const backgroundClass = variant === 'time'
    ? 'bg-gradient-to-br from-indigo-500/20 via-slate-900/40 to-cyan-500/20'
    : 'bg-white/5';
  const isEvolve = variant === 'evolve-appointment';

  return (
    <div className={`rounded-2xl border border-white/10 ${backgroundClass} p-4 space-y-4 ${isEvolve ? 'a2ui-card a2ui-card--evolve' : ''}`} style={cardStyle}>
      {isEvolve && (
        <>
          <div className="a2ui-card__glow" />
          <div className="a2ui-card__frame" />
        </>
      )}
      <div className="relative z-10 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-xl" style={headerStyle}>
              {icon}
            </div>
            <div>
              {title && <p className="text-xs uppercase tracking-[0.3em] text-current opacity-60">{title}</p>}
              {subtitle && <p className="text-sm font-semibold">{subtitle}</p>}
              {meta && <p className="text-xs opacity-60">{meta}</p>}
            </div>
          </div>
          {badgeItems.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-end">
              {badgeItems.slice(0, 4).map((badge: any, idx: number) => (
                <span
                  key={`${badge?.label || badge}-${idx}`}
                  className="px-2 py-1 rounded-full text-[10px] uppercase tracking-[0.2em] bg-white/10 border border-white/10"
                >
                  {typeof badge === 'string' ? badge : badge?.label || 'Info'}
                </span>
              ))}
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function A2UIAppointmentCard({
  node,
  renderNode
}: {
  node: A2UIElement;
  renderNode: (child: A2UIElement, key: string) => ReactNode;
}) {
  const children = node.children ?? [];
  const dividerIndex = children.findIndex(
    (child) => child.type === 'Text' && resolveTextRole(child) === 'divider'
  );
  const headerChildren = dividerIndex >= 0 ? children.slice(0, dividerIndex) : children;
  const restChildren = dividerIndex >= 0 ? children.slice(dividerIndex + 1) : [];
  const detailChildren: A2UIElement[] = [];
  const tailChildren: A2UIElement[] = [];
  let collectingDetails = true;

  restChildren.forEach((child) => {
    const role = resolveTextRole(child);
    const isDetail = child.type === 'Text' && (role === 'label' || role === 'value');
    if (collectingDetails && isDetail) {
      detailChildren.push(child);
    } else {
      collectingDetails = false;
      tailChildren.push(child);
    }
  });

  return (
    <div className="a2ui-card a2ui-card--evolve">
      <div className="a2ui-card__glow" />
      <div className="a2ui-card__frame" />
      <div className="a2ui-card__content">
        {headerChildren.map((child, idx) => renderNode(child, `${child.type}-${idx}`))}
        {dividerIndex >= 0 && <div className="a2ui-divider" />}
        {detailChildren.length > 0 && (
          <div className="a2ui-detail-grid">
            {detailChildren.map((child, idx) => renderNode(child, `${child.type}-detail-${idx}`))}
          </div>
        )}
        {tailChildren.length > 0 && (
          <div className="space-y-3">
            {tailChildren.map((child, idx) => renderNode(child, `${child.type}-tail-${idx}`))}
          </div>
        )}
      </div>
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

function A2UIMap({ node }: { node: A2UIElement }) {
  const query = typeof node.props?.query === 'string' ? node.props.query : '';
  const lat = typeof node.props?.lat === 'number' ? node.props.lat : null;
  const lng = typeof node.props?.lng === 'number' ? node.props.lng : null;
  const zoom = typeof node.props?.zoom === 'number' ? node.props.zoom : 14;
  const height = typeof node.props?.height === 'number' ? node.props.height : 220;
  const title = typeof node.props?.title === 'string' ? node.props.title : 'Map';
  const marker = lat !== null && lng !== null ? `${lat},${lng}` : '';
  const q = marker || query;
  const src = q
    ? `https://www.google.com/maps?q=${encodeURIComponent(q)}&z=${encodeURIComponent(String(zoom))}&output=embed`
    : 'about:blank';

  return (
    <div className="a2ui-map">
      <iframe
        title={title}
        src={src}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        className="a2ui-map__frame"
        style={{ height: `${height}px` }}
      />
    </div>
  );
}

type CalendarSlot = {
  time: string;
  label?: string;
  status?: 'available' | 'booked' | 'unavailable';
};

function A2UICalendar({ node }: { node: A2UIElement }) {
  const dateLabel = typeof node.props?.date === 'string' ? node.props.date : '';
  const timezone = typeof node.props?.timezone === 'string' ? node.props.timezone : '';
  const slots = Array.isArray(node.props?.slots) ? (node.props.slots as CalendarSlot[]) : [];
  const title = typeof node.props?.title === 'string' ? node.props.title : 'Available slots';
  return (
    <div className="a2ui-calendar">
      <div className="a2ui-calendar__header">
        <div>
          <p className="a2ui-text--eyebrow">Availability</p>
          <p className="a2ui-text--title">{title}</p>
        </div>
        <div className="a2ui-calendar__meta">
          {dateLabel && <span>{dateLabel}</span>}
          {timezone && <span>{timezone}</span>}
        </div>
      </div>
      <div className="a2ui-calendar__grid">
        {slots.length === 0 ? (
          <div className="a2ui-calendar__empty">No availability listed.</div>
        ) : (
          slots.map((slot, idx) => {
            const status = slot.status || 'available';
            const className =
              status === 'available'
                ? 'a2ui-slot a2ui-slot--available'
                : status === 'booked'
                ? 'a2ui-slot a2ui-slot--booked'
                : 'a2ui-slot a2ui-slot--unavailable';
            return (
              <div key={`${slot.time}-${idx}`} className={className}>
                <span className="a2ui-slot__time">{slot.time}</span>
                {slot.label && <span className="a2ui-slot__label">{slot.label}</span>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function A2UIRenderer({ ui, fallbackText, onEvent, className }: A2UIRendererProps) {
  const nodes = Array.isArray(ui) ? ui : [ui];

  const renderNode = (node: A2UIElement, key: string): ReactNode => {
    switch (node.type) {
      case 'Card':
        if (node.props?.variant === 'evolve-appointment') {
          return <A2UIAppointmentCard key={key} node={node} renderNode={renderNode} />;
        }
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
      case 'Map':
        return <A2UIMap key={key} node={node} />;
      case 'Calendar':
        return <A2UICalendar key={key} node={node} />;
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
      <div className={`a2ui-root ${className || 'space-y-3'}`}>
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
