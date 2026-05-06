import { useEffect, type RefObject } from 'react';

/**
 * Closes a popover/menu when the user mousedowns outside its container or
 * presses Escape. Returns nothing — call once at the top of a component
 * with a ref to the popover root and a handler that toggles its visibility.
 *
 * The listeners attach to `document`, not a React container, because by
 * definition the close trigger is a click *outside* the component subtree,
 * which means React's synthetic-event system can't see it: we need a
 * document-level listener with a ref-contains check. (Backdrop overlays
 * solve the same problem at the cost of a stacking-context layer; portal-
 * based UI libraries like Radix do this in their own internal way.)
 *
 * The effect is a no-op when `enabled` is false so consumers can keep the
 * hook unconditional and let React strip the listeners while the popover
 * is closed.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, onClose, enabled]);
}
