import { useEffect, useState, type ReactNode } from 'react';

export type Route = 'apply' | 'assistant' | 'admin';
const fromHash = (): Route => (location.hash.startsWith('#/assistant') ? 'assistant' : location.hash.startsWith('#/admin') ? 'admin' : 'apply');

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(fromHash);
  useEffect(() => {
    const on = () => setRoute(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const link = (r: Route, href: string, label: string) => (
    <a href={href} aria-current={route === r ? 'page' : undefined}>{label}</a>
  );
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="topbar__in">
          <a className="brand" href="#/" aria-label="Kanak gold loans, home">
            <span className="brand__ingot" aria-hidden="true" />
            Kanak
          </a>
          <nav className="nav" aria-label="Primary">
            {link('apply', '#/', 'Apply')}
            {link('assistant', '#/assistant', 'Assistant')}
            {link('admin', '#/admin', 'Admin')}
          </nav>
        </div>
      </header>
      <main id="main" className="main">{children}</main>
    </>
  );
}

export function StepIndicator({ step, labels }: { step: number; labels: string[] }) {
  return (
    <ol className="steps" aria-label="Application progress">
      {labels.map((l, i) => (
        <li key={l} aria-current={step === i + 1 ? 'step' : undefined} className={step > i + 1 ? 'done' : undefined}>
          <span className="n">{step > i + 1 ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg> : `0${i + 1}`}</span>
          <span className="label">{l}</span>
        </li>
      ))}
    </ol>
  );
}
