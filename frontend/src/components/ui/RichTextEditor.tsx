'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Link2 } from 'lucide-react';

// PR-LIA-CONVO-NOTES — shared, dependency-free rich-text editor.
//
// First consumer: LIA conversation notes. Built to be reused verbatim for the
// ticket composer next, so it takes only generic props and knows nothing about
// notes/tickets.
//
// Deliberately minimal: bold / italic / underline / bullet + numbered lists /
// links, via contentEditable + document.execCommand. execCommand is deprecated
// but universally supported and needs no library — the right trade for "keep it
// simple". The HTML this produces is NEVER trusted: the server sanitizes every
// body against an allowlist before it is stored (see rich-text-sanitizer.ts).
//
// Controlled-input caveat: rewriting innerHTML on every keystroke moves the
// caret to the start. So we seed the DOM from `value` only on mount and when
// `value` changes while the editor is NOT focused (e.g. switching which note is
// being edited). Live typing flows out through onChange and is never fed back.

const NAVY = '#1e3a5f';

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write here…',
  disabled = false,
  ariaLabel = 'Rich text editor',
  minHeight = 140,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Seed / re-seed only when not focused, to avoid caret jumps mid-typing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const focused = document.activeElement === el;
    if (!focused && el.innerHTML !== value) {
      el.innerHTML = value || '';
    }
  }, [value]);

  const emit = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML);
  }, [onChange]);

  const exec = useCallback(
    (command: string, arg?: string) => {
      if (disabled) return;
      const el = ref.current;
      if (el) el.focus();
      // eslint-disable-next-line deprecation/deprecation
      document.execCommand(command, false, arg);
      emit();
    },
    [disabled, emit],
  );

  const onLink = useCallback(() => {
    if (disabled) return;
    const url = window.prompt('Link URL (https://…)');
    if (!url) return;
    // Only allow safe schemes at the UI level; the server enforces the real
    // allowlist regardless of what is entered here.
    const safe = /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}`;
    exec('createLink', safe);
  }, [disabled, exec]);

  const isEmpty = !value || value === '<br>' || value.replace(/<[^>]*>/g, '').trim() === '';

  return (
    <div
      className={`rounded-xl border ${disabled ? 'opacity-60' : ''}`}
      style={{ borderColor: 'rgba(30,58,95,0.2)' }}
    >
      {/* Toolbar */}
      <div
        className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5"
        style={{ borderColor: 'rgba(30,58,95,0.12)' }}
      >
        <ToolbarButton label="Bold" onClick={() => exec('bold')} disabled={disabled}><Bold size={16} /></ToolbarButton>
        <ToolbarButton label="Italic" onClick={() => exec('italic')} disabled={disabled}><Italic size={16} /></ToolbarButton>
        <ToolbarButton label="Underline" onClick={() => exec('underline')} disabled={disabled}><Underline size={16} /></ToolbarButton>
        <span className="mx-1 h-5 w-px" style={{ background: 'rgba(30,58,95,0.15)' }} />
        <ToolbarButton label="Bulleted list" onClick={() => exec('insertUnorderedList')} disabled={disabled}><List size={16} /></ToolbarButton>
        <ToolbarButton label="Numbered list" onClick={() => exec('insertOrderedList')} disabled={disabled}><ListOrdered size={16} /></ToolbarButton>
        <span className="mx-1 h-5 w-px" style={{ background: 'rgba(30,58,95,0.15)' }} />
        <ToolbarButton label="Insert link" onClick={onLink} disabled={disabled}><Link2 size={16} /></ToolbarButton>
      </div>

      {/* Editable surface. The placeholder is a CSS ::before on the empty state. */}
      <div className="relative">
        {isEmpty && (
          <div
            className="pointer-events-none absolute left-3 top-3 text-sm"
            style={{ color: 'rgba(74,74,74,0.45)' }}
          >
            {placeholder}
          </div>
        )}
        <div
          ref={ref}
          role="textbox"
          aria-label={ariaLabel}
          aria-multiline="true"
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          className="rte-surface px-3 py-3 text-sm leading-relaxed focus:outline-none"
          style={{ minHeight, color: NAVY }}
        />
      </div>

      {/* Scoped list styling so bullets/numbers actually render inside the box. */}
      <style jsx global>{`
        .rte-surface ul { list-style: disc; margin: 0.25rem 0 0.25rem 1.25rem; }
        .rte-surface ol { list-style: decimal; margin: 0.25rem 0 0.25rem 1.25rem; }
        .rte-surface a { color: ${NAVY}; text-decoration: underline; }
        .rte-surface:focus { outline: none; }
      `}</style>
    </div>
  );
}

function ToolbarButton({
  label, onClick, disabled, children,
}: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // Prevent the mousedown from stealing focus/selection from the editor.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#1e3a5f] transition-colors hover:bg-[#faf8f3] disabled:opacity-40"
    >
      {children}
    </button>
  );
}
