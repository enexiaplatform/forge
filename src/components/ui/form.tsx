import { useEffect, useRef, type ReactNode, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react';

const control = 'w-full rounded-lg border border-ink-300 bg-white px-3 text-ui text-ink-950 placeholder:text-ink-400 focus:border-accent-500 focus:outline-none focus:shadow-focus';

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="forge-label mb-1.5 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-meta text-ink-500">{hint}</span>}
    </label>
  );
}

export const TextInput = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${control} h-9 ${p.className ?? ''}`} />;
export const TextArea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={`${control} py-2 leading-5 ${p.className ?? ''}`} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${control} h-9 ${p.className ?? ''}`} />;

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="mb-4 flex items-start gap-2 text-dense text-ink-800">
      <input type="checkbox" className="mt-1 accent-accent-800" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** A dialog. Escape and the backdrop close it; focus moves into it. */
export function Modal({ title, kicker, onClose, children, footer }: { title: ReactNode; kicker?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  // Focus once, on open — re-focusing on every render would pull the caret out of whatever is being typed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-iron/40 px-4 py-16" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" className="w-full max-w-[560px] rounded-xl bg-white shadow-overlay">
        <div className="border-b border-ink-200 px-6 pb-4 pt-5">
          {kicker && <p className="forge-label mb-1">{kicker}</p>}
          <h2 className="text-signal text-ink-950">{title}</h2>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-ink-200 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
