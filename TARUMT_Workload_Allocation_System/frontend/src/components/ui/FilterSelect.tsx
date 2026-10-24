"use client";

import { Children, Fragment, isValidElement, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";

interface FilterSelectProps {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  icon?: LucideIcon;
  fullWidth?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  menuWidth?: number;
  triggerClassName?: string;
  children: ReactNode;
}

/** Join JSX label fragments without String(array)'s unwanted commas. */
function optionText(children: ReactNode): string {
  return Children.toArray(children).map((child): string => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    return isValidElement(child) ? optionText((child.props as { children?: ReactNode }).children) : "";
  }).join("");
}

/** Shared Course Assignment dropdown: the academic-year menu design, with
 * bounded width, wrapping option labels and an independently scrolling list.
 */
export default function FilterSelect({
  ariaLabel, value, onChange, icon: Icon, fullWidth = false, disabled = false, searchable = true, menuWidth,
  triggerClassName = "", children,
}: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [placement, setPlacement] = useState({ width: 288, left: 0, maxHeight: 288, above: false });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const options: Array<{ value: string; label: string; disabled: boolean; group: string | null }> = [];
  Children.toArray(children).filter(isValidElement).forEach((element) => {
    const props = element.props as { value?: unknown; label?: unknown; children?: ReactNode; disabled?: boolean };
    if (props.value === undefined && typeof props.label === "string") {
      Children.toArray(props.children).filter(isValidElement).forEach((child) => {
        const childProps = child.props as { value?: unknown; children?: ReactNode; disabled?: boolean };
        options.push({
          value: String(childProps.value ?? ""),
          label: optionText(childProps.children),
          disabled: childProps.disabled === true,
          group: props.label as string,
        });
      });
      return;
    }
    options.push({
      value: String(props.value ?? ""),
      label: optionText(props.children),
      disabled: props.disabled === true,
      group: null,
    });
  });
  const selected = options.find((option) => option.value === value) ?? options[0];
  const searched = searchable ? term.trim().toLowerCase() : "";
  const visibleOptions = searched
    ? options.filter((option) => option.label.toLowerCase().includes(searched) || option.group?.toLowerCase().includes(searched))
    : options;

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    let left = 8;
    let right = window.innerWidth - 8;
    let top = 8;
    let bottom = window.innerHeight - 8;
    let ancestor = root.parentElement;
    while (ancestor) {
      const style = window.getComputedStyle(ancestor);
      const bounds = ancestor.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        left = Math.max(left, bounds.left + 8);
        right = Math.min(right, bounds.right - 8);
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        top = Math.max(top, bounds.top + 8);
        bottom = Math.min(bottom, bounds.bottom - 8);
      }
      ancestor = ancestor.parentElement;
    }
    // Never let the longest programme name set the menu's intrinsic width.
    const width = Math.max(0, Math.min(Math.max(rect.width, menuWidth ?? (searchable ? 288 : 220)), 360, right - left));
    const menuLeft = Math.max(left, Math.min(rect.left, right - width));
    const below = Math.max(0, bottom - rect.bottom - 4);
    const above = Math.max(0, rect.top - top - 4);
    const openAbove = below < 170 && above > below;
    setPlacement({ width, left: menuLeft - rect.left, maxHeight: Math.min(288, openAbove ? above : below), above: openAbove });
  }, [menuWidth, searchable]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const show = () => {
    if (disabled) return;
    setTerm("");
    measure();
    setOpen(true);
  };

  useEffect(() => {
    if (!open || disabled) return;
    if (searchable) searchRef.current?.focus({ preventScroll: true });
    else {
      const option = listRef.current?.querySelector<HTMLButtonElement>("button[aria-selected='true']:not(:disabled)")
        ?? listRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
      option?.focus({ preventScroll: true });
    }
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) measure();
    };
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, disabled, measure, searchable]);

  return (
    <div
      ref={rootRef}
      className={`relative min-w-0 max-w-full ${fullWidth ? "w-full" : "w-full sm:w-auto sm:max-w-[260px]"} ${open && !disabled ? "z-30" : ""}`}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (!open) { show(); return; }
          const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
          if (!buttons.length) return;
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = index < 0 ? (event.key === "ArrowDown" ? 0 : buttons.length - 1)
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
          const button = buttons[next];
          button.focus({ preventScroll: true });
          const list = listRef.current!;
          const rowBounds = button.getBoundingClientRect();
          const listBounds = list.getBoundingClientRect();
          if (rowBounds.top < listBounds.top) list.scrollTop += rowBounds.top - listBounds.top;
          else if (rowBounds.bottom > listBounds.bottom) list.scrollTop += rowBounds.bottom - listBounds.bottom;
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-expanded={open && !disabled}
        aria-label={ariaLabel}
        onClick={() => open ? close() : show()}
        className={`relative flex min-h-9 w-full items-center gap-xs rounded-button border bg-surface py-[7px] pl-md pr-8 text-[13px] font-medium text-textNormal outline-none transition-colors focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primaryLight disabled:cursor-not-allowed disabled:opacity-60 ${open && !disabled ? "border-primary" : "border-divider hover:bg-background"} ${triggerClassName}`}
      >
        {Icon && <Icon size={14} className="shrink-0 text-textSecondary" />}
        <span className="min-w-0 flex-1 whitespace-normal break-words text-left leading-[20px]" title={selected?.label}>{selected?.label ?? "—"}</span>
        <ChevronDown size={14} className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-textSecondary transition-transform duration-200 ${open && !disabled ? "rotate-180" : ""}`} />
      </button>

      {open && !disabled && (
        <div
          ref={menuRef}
          className={`animate-[menuIn_0.18s_ease-out_both] absolute z-30 overflow-hidden rounded-card border border-divider bg-surface shadow-card ${placement.above ? "bottom-full mb-xs origin-bottom-left" : "top-full mt-xs origin-top-left"}`}
          style={{ width: placement.width, left: placement.left, maxHeight: placement.maxHeight }}
        >
          {searchable && <div className="border-b border-divider p-xs">
            <input
              ref={searchRef}
              type="text"
              value={term}
              onChange={(event) => { setTerm(event.target.value); if (listRef.current) listRef.current.scrollTop = 0; }}
              placeholder="Search…"
              aria-label={`Search — ${ariaLabel}`}
              className="h-9 w-full min-w-0 rounded-button border border-divider bg-background px-md text-[12.5px] text-text outline-none transition-colors placeholder:text-textPlaceholder focus:border-primary focus:ring-4 focus:ring-primaryLight"
            />
          </div>}
          <div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className="overflow-y-auto overflow-x-hidden py-xs" style={{ maxHeight: Math.max(0, placement.maxHeight - (searchable ? 54 : 10)) }}>
            {visibleOptions.map((option, index) => {
              const opensGroup = option.group !== null && option.group !== visibleOptions[index - 1]?.group;
              return (
                <Fragment key={`${option.group ?? "option"}-${option.value}`}>
                  {opensGroup && (
                    <p className={`${index === 0 ? "" : "mt-1 border-t border-divider"} px-md pb-[6px] pt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-textSecondary`}>
                      {option.group}
                    </p>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    disabled={option.disabled}
                    title={option.label}
                    onClick={() => { onChange(option.value); close(); }}
                    className={`flex min-h-9 w-full items-start gap-sm px-md py-2 text-left text-[13px] leading-[20px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-not-allowed disabled:text-textDisabled ${option.value === value ? "bg-primaryLight font-semibold text-primary" : "font-medium text-textNormal hover:bg-hoverBg"}`}
                  >
                    <span className="min-w-0 flex-1 whitespace-normal break-words">{option.label}</span>
                    <span className="mt-[3px] w-[14px] shrink-0">{option.value === value && <Check size={14} />}</span>
                  </button>
                </Fragment>
              );
            })}
            {visibleOptions.length === 0 && <p className="break-words px-md py-md text-[12.5px] italic text-textSecondary">No match for “{term.trim()}”</p>}
          </div>
        </div>
      )}
    </div>
  );
}
