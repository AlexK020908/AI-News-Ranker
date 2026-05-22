"use client";

import { useEffect, useId, useRef, useState } from "react";

interface Option {
  value: string;
  label: string;
}

interface Props {
  label: string;
  value: string | null;
  options: Option[];
  placeholder?: string;
  onChange: (next: string | null) => void;
}

// Custom single-select dropdown. Native <select> on Windows leaks the OS
// light theme through Chrome/Edge unless every form control gets a
// color-scheme override — and even then the options popup can't be
// styled. Rolling our own gives full control of both states and a
// consistent dark look.
export function Select({ label, value, options, placeholder, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  const display = current?.label ?? placeholder ?? "Any";

  return (
    <div className="select" ref={ref}>
      <span className="select__label">{label}</span>
      <button
        type="button"
        className={`select__trigger${value ? " is-active" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="select__value">{display}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="select__menu"
        >
          <li
            role="option"
            aria-selected={value === null}
            className={`select__option${value === null ? " is-selected" : ""}`}
            onClick={() => { onChange(null); setOpen(false); }}
          >
            <span>{placeholder ?? "Any"}</span>
          </li>
          {options.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={value === o.value}
              className={`select__option${value === o.value ? " is-selected" : ""}`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              <span>{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
