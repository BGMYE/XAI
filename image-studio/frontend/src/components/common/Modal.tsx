import { ReactNode, Ref, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { usePlatform } from "../../platform/context";
import {
  beginBackdropPointerGesture,
  shouldDismissFromBackdropPointer,
  type BackdropPointerGesture,
} from "./modalBackdrop";

const openDialogs: HTMLElement[] = [];
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

// Only the top dialog owns focus and Escape; nested dialogs restore their opener.
export function Modal({
  open, onClose, title, children, width = 480, backdropClassName = "", cardClassName = "", headerClassName = "", bodyClassName = "", bodyRef,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  width?: number;
  backdropClassName?: string;
  cardClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  bodyRef?: Ref<HTMLDivElement>;
}) {
  const { isAndroidPhone, usesFluentUI, usesAppleUI } = usePlatform();
  const backdropPointerGesture = useRef<BackdropPointerGesture | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  closeRef.current = onClose;
  useEffect(() => {
    if (!open || !cardRef.current) return;
    const card = cardRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inertSiblings = [...document.body.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdropRef.current);
    const previousInert = inertSiblings.map((element) => [element, element.inert] as const);
    for (const element of inertSiblings) element.inert = true;
    openDialogs.push(card);
    const focusable = () => [...card.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => !element.closest('[hidden], [inert]') && element.getClientRects().length > 0);
    (focusable()[0] ?? card).focus();
    const onKey = (e: KeyboardEvent) => {
      if (openDialogs.at(-1) !== card || (e.target instanceof Element && e.target.closest('[role="menu"]'))) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); }
      if (e.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (!first) { e.preventDefault(); card.focus(); }
        else if (e.shiftKey && (document.activeElement === first || !card.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !card.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (openDialogs.at(-1) !== card || card.contains(event.target as Node)) return;
      if (event.target instanceof Element && event.target.closest('[role="menu"]')) return;
      (focusable()[0] ?? card).focus();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocus);
      const index = openDialogs.indexOf(card);
      if (index !== -1) openDialogs.splice(index, 1);
      for (const [element, inert] of previousInert) element.inert = inert;
      if (opener?.isConnected && !opener.closest('[inert]')) opener.focus();
    };
  }, [open]);

  if (!open) return null;
  const modal = (
    <div
      ref={backdropRef}
      className={`app-modal-backdrop ${isAndroidPhone ? "app-modal-backdrop-phone" : "app-modal-backdrop-desktop"} ${backdropClassName}`}
      onPointerDownCapture={(event) => {
        backdropPointerGesture.current = beginBackdropPointerGesture(
          event.pointerId,
          event.target === event.currentTarget,
        );
      }}
      onPointerUpCapture={(event) => {
        const shouldClose = shouldDismissFromBackdropPointer(
          backdropPointerGesture.current,
          event.pointerId,
          event.target === event.currentTarget,
        );
        backdropPointerGesture.current = null;
        if (shouldClose) onClose();
      }}
      onPointerCancelCapture={() => {
        backdropPointerGesture.current = null;
      }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "弹窗"}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        className={`app-modal-card ${usesAppleUI ? "liquid-glass-panel" : ""} ${isAndroidPhone ? "app-modal-card-phone" : "app-modal-card-desktop"} ${usesFluentUI ? "app-modal-card-windows" : ""} ${cardClassName}`}
      >
        {title && (
          <div className={`app-modal-header ${isAndroidPhone ? "app-modal-header-phone" : "app-modal-header-desktop"} ${headerClassName}`}>
            <h3 id={titleId} className="m-0 text-[15px] font-semibold tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">{title}</h3>
            <button
              onClick={onClose}
              type="button"
              aria-label="关闭"
              title="关闭 (Esc)"
              className={`-mr-1 p-1.5 text-zinc-500 hover:bg-black/[0.05] hover:text-zinc-900 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100 ${usesFluentUI ? "rounded-[8px]" : "rounded-full"}`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div ref={bodyRef} className={`modal-scroll-body app-modal-body ${isAndroidPhone ? "app-modal-body-phone" : "app-modal-body-desktop"} ${bodyClassName}`}>{children}</div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return modal;
  return createPortal(modal, document.body);
}
