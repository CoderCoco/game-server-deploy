import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { useClickOutside } from './use-click-outside.hook.js';

afterEach(cleanup);

describe('useClickOutside', () => {
  it('should call onClose when a mousedown occurs outside the ref element', () => {
    const onClose = vi.fn();
    const div = document.createElement('div');
    document.body.appendChild(div);

    renderHook(() => {
      const ref = useRef<HTMLElement | null>(div);
      useClickOutside(ref, onClose, true);
    });

    // Fire mousedown on a node that is not inside div.
    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledOnce();
    document.body.removeChild(div);
  });

  it('should not call onClose when mousedown occurs on a child node inside the ref element', () => {
    const onClose = vi.fn();
    const div = document.createElement('div');
    const child = document.createElement('span');
    div.appendChild(child);
    document.body.appendChild(div);

    renderHook(() => {
      const ref = useRef<HTMLElement | null>(div);
      useClickOutside(ref, onClose, true);
    });

    act(() => {
      child.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
    document.body.removeChild(div);
  });

  it('should call onClose when the Escape key is pressed', () => {
    const onClose = vi.fn();
    const div = document.createElement('div');

    renderHook(() => {
      const ref = useRef<HTMLElement | null>(div);
      useClickOutside(ref, onClose, true);
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('should not call onClose for non-Escape key presses', () => {
    const onClose = vi.fn();
    const div = document.createElement('div');

    renderHook(() => {
      const ref = useRef<HTMLElement | null>(div);
      useClickOutside(ref, onClose, true);
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('should not attach any listeners when enabled is false', () => {
    const onClose = vi.fn();
    const div = document.createElement('div');

    renderHook(() => {
      const ref = useRef<HTMLElement | null>(div);
      useClickOutside(ref, onClose, false);
    });

    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('should remove event listeners on unmount so no stale calls fire', () => {
    const onClose = vi.fn();
    const div = document.createElement('div');

    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(div);
      useClickOutside(ref, onClose, true);
    });

    unmount();

    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('should remove listeners when enabled transitions from true to false', () => {
    const onClose = vi.fn();
    const div = document.createElement('div');

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => {
        const ref = useRef<HTMLElement | null>(div);
        useClickOutside(ref, onClose, enabled);
      },
      { initialProps: { enabled: true } },
    );

    rerender({ enabled: false });

    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });
});
