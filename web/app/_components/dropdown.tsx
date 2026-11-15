"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck } from "./icons";

export interface DropdownOption {
  value: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
}

export interface DropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export default function Dropdown({
  value,
  onChange,
  options,
  placeholder = "Select an option…",
  className = "",
  ariaLabel,
  disabled = false,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel || placeholder}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border bg-surface/90 px-3.5 py-2 text-xs font-medium text-ink transition select-none disabled:opacity-50 disabled:cursor-not-allowed ${
          open
            ? "border-accent/60 ring-1 ring-accent/30 shadow-[0_0_20px_-6px_rgba(94,240,136,0.25)]"
            : "border-line hover:border-line/90 hover:bg-surface"
        }`}
      >
        <span className="truncate">
          {selected ? selected.label : <span className="text-muted">{placeholder}</span>}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
            open ? "rotate-180 text-accent" : "text-muted"
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Flyout Menu */}
      {open && (
        <ul
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel || placeholder}
          className="absolute left-0 z-50 mt-1.5 max-h-60 w-full min-w-[200px] overflow-y-auto rounded-xl border border-line bg-panel p-1.5 shadow-2xl backdrop-blur-md focus:outline-none"
        >
          {options.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted">No options available</li>
          ) : (
            options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition ${
                    opt.disabled
                      ? "opacity-40 cursor-not-allowed text-muted"
                      : isSelected
                      ? "bg-accent/15 text-accent font-semibold"
                      : "text-ink/80 hover:bg-surface hover:text-ink"
                  }`}
                >
                  <div className="flex flex-col truncate">
                    <span className="truncate">{opt.label}</span>
                    {opt.sublabel && (
                      <span className="text-[10px] text-muted">{opt.sublabel}</span>
                    )}
                  </div>
                  {isSelected && (
                    <IconCheck className="ml-2 h-3.5 w-3.5 shrink-0 text-accent" />
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
