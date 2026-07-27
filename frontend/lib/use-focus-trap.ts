import { useLayoutEffect, useRef, type RefObject } from "react";

const focusableSelector =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

type FocusTrapOptions = {
  isolateBackground?: boolean;
};

type BackgroundIsolationState = {
  count: number;
  inert: boolean;
  ariaHidden: string | null;
};

const backgroundIsolationState = new Map<HTMLElement, BackgroundIsolationState>();

function isolateBackgroundFrom(container: HTMLElement) {
  const backgroundElements = Array.from(document.body.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement && !element.contains(container),
  );

  for (const element of backgroundElements) {
    const existing = backgroundIsolationState.get(element);
    if (existing) {
      existing.count += 1;
      continue;
    }

    backgroundIsolationState.set(element, {
      count: 1,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    });
    element.inert = true;
    element.setAttribute("aria-hidden", "true");
  }

  return () => {
    for (const element of backgroundElements) {
      const state = backgroundIsolationState.get(element);
      if (!state) continue;

      state.count -= 1;
      if (state.count > 0) continue;

      element.inert = state.inert;
      if (state.ariaHidden === null) {
        element.removeAttribute("aria-hidden");
      } else {
        element.setAttribute("aria-hidden", state.ariaHidden);
      }
      backgroundIsolationState.delete(element);
    }
  };
}

export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  active: boolean,
  initialFocusRef?: RefObject<HTMLElement | null>,
  options: FocusTrapOptions = {},
) {
  const containerRef = useRef<T>(null);
  const { isolateBackground = false } = options;

  useLayoutEffect(() => {
    if (!active) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let focusFrame: number | null = null;
    let restoreBackground: (() => void) | null = null;

    const focusInitialElement = () => {
      const container = containerRef.current;
      if (!container || (initialFocusRef && !initialFocusRef.current)) {
        focusFrame = window.requestAnimationFrame(focusInitialElement);
        return;
      }
      if (isolateBackground && !restoreBackground) {
        restoreBackground = isolateBackgroundFrom(container);
      }
      const preferred = initialFocusRef?.current;
      const first = preferred && container.contains(preferred)
        ? preferred
        : container.querySelector<HTMLElement>(focusableSelector);

      first?.focus({ preventScroll: true });
    };
    focusInitialElement();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = container.querySelectorAll<HTMLElement>(focusableSelector);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!first || !last) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      if (focusFrame !== null) {
        window.cancelAnimationFrame(focusFrame);
      }
      document.removeEventListener("keydown", handleKeyDown);
      restoreBackground?.();
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [active, initialFocusRef, isolateBackground]);

  return containerRef;
}
