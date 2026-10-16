import type { InputHTMLAttributes, ReactNode } from 'react';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string;
  affix?: string;
  children?: ReactNode;
}

/** Labelled input with an always-reserved error line (no layout jump) and aria wiring. */
export function Field({ id, label, error, hint, affix, children, ...input }: Props) {
  const describedBy = [hint ? `${id}-hint` : '', `${id}-err`].filter(Boolean).join(' ');
  const el = <input id={id} className="input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {affix ? <div className="input-affix">{el}<span className="affix" aria-hidden="true">{affix}</span></div> : el}
      {children}
      {hint && <span id={`${id}-hint`} className="hint">{hint}</span>}
      <span key={error ?? 'none'} id={`${id}-err`} className="err" role={error ? 'alert' : undefined}>{error ?? ''}</span>
    </div>
  );
}
