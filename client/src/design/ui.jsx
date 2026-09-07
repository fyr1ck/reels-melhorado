import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import './ui.css';

/**
 * Primitivos da interface.
 *
 * O projeto anterior espalhava `className="btn btn-sm btn-danger"` por toda
 * parte, e cada tela reinventava espaçamento e estado de carregamento. Aqui a
 * decisão de estilo mora num lugar só: mudar o botão muda o app inteiro.
 */

const cx = (...parts) => parts.filter(Boolean).join(' ');

// ---------- Button ----------

export const Button = forwardRef(function Button(
  { variant = 'default', size = 'md', loading, icon: Icon, children, className, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx('ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={15} className="spin" /> : Icon && <Icon size={size === 'sm' ? 13 : 15} />}
      {children && <span>{children}</span>}
    </button>
  );
});

// ---------- Card ----------

export function Card({ title, icon: Icon, action, tone, children, className, ...rest }) {
  return (
    <section className={cx('ui-card', tone && `ui-card--${tone}`, className)} {...rest}>
      {(title || action) && (
        <header className="ui-card__head">
          <h3>{Icon && <Icon size={15} />}{title}</h3>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

// ---------- Badge ----------

/** `tone` casa com os níveis que o servidor devolve em `health.level`. */
export function Badge({ tone = 'muted', children, className }) {
  return <span className={cx('ui-badge', `ui-badge--${tone}`, className)}>{children}</span>;
}

// ---------- Métrica ----------

export function Metric({ label, value, hint, icon: Icon, tone }) {
  return (
    <div className={cx('ui-metric', tone && `ui-metric--${tone}`)}>
      <span className="ui-metric__label">{Icon && <Icon size={13} />}{label}</span>
      <span className="metric-value ui-metric__value">{value}</span>
      {hint && <span className="ui-metric__hint">{hint}</span>}
    </div>
  );
}

// ---------- Campos ----------

export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cx('ui-field', className)}>
      {label && <span className="ui-field__label">{label}</span>}
      {children}
      {error ? <span className="ui-field__error">{error}</span> : hint && <span className="ui-field__hint">{hint}</span>}
    </label>
  );
}

export const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx('ui-input', className)} {...rest} />;
});

export const Textarea = forwardRef(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx('ui-input ui-textarea', className)} {...rest} />;
});

export const Select = forwardRef(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx('ui-input ui-select', className)} {...rest}>
      {children}
    </select>
  );
});

export function Checkbox({ label, hint, className, ...rest }) {
  return (
    <label className={cx('ui-check', className)}>
      <input type="checkbox" {...rest} />
      <span>
        {label}
        {hint && <em>{hint}</em>}
      </span>
    </label>
  );
}

// ---------- Abas ----------

export function Tabs({ value, onChange, items }) {
  return (
    <div className="ui-tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          aria-selected={value === item.value}
          className={cx('ui-tab', value === item.value && 'is-active')}
          onClick={() => onChange(item.value)}
        >
          {item.label}
          {item.count !== undefined && <span className="ui-tab__count">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- Estados ----------

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="ui-empty">
      {Icon && <div className="ui-empty__icon"><Icon size={22} /></div>}
      <p className="ui-empty__title">{title}</p>
      {children && <p className="ui-empty__text">{children}</p>}
      {action}
    </div>
  );
}

/** Esqueleto durante o carregamento — evita o salto de layout do spinner. */
export function Skeleton({ height = 16, width = '100%', className }) {
  return <span className={cx('ui-skeleton', className)} style={{ height, width }} />;
}

export function Banner({ tone = 'warn', icon: Icon, children, action }) {
  return (
    <div className={cx('ui-banner', `ui-banner--${tone}`)}>
      {Icon && <Icon size={16} />}
      <div className="ui-banner__body">{children}</div>
      {action}
    </div>
  );
}

// ---------- Barra de progresso ----------

export function Meter({ value, max = 100, tone = 'brand', label }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="ui-meter" role="progressbar" aria-valuenow={value} aria-valuemax={max} aria-label={label}>
      <div className={cx('ui-meter__fill', `ui-meter__fill--${tone}`)} style={{ width: `${pct}%` }} />
    </div>
  );
}
