"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

type DecorativeMotionOptions = {
  disableOnCoarsePointer?: boolean;
  disableOnSmallScreen?: boolean;
};

export function useDecorativeMotionEnabled({
  disableOnCoarsePointer = true,
  disableOnSmallScreen = true,
}: DecorativeMotionOptions = {}) {
  const reduceMotion = useReducedMotion();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (reduceMotion || typeof window === "undefined") {
      setEnabled(false);
      return;
    }

    const queries = [
      disableOnCoarsePointer ? window.matchMedia("(pointer: coarse)") : null,
      disableOnSmallScreen ? window.matchMedia("(max-width: 768px)") : null,
    ].filter((query): query is MediaQueryList => Boolean(query));

    const update = () => {
      setEnabled(document.visibilityState === "visible" && queries.every((query) => !query.matches));
    };

    update();
    document.addEventListener("visibilitychange", update);
    queries.forEach((query) => query.addEventListener("change", update));

    return () => {
      document.removeEventListener("visibilitychange", update);
      queries.forEach((query) => query.removeEventListener("change", update));
    };
  }, [disableOnCoarsePointer, disableOnSmallScreen, reduceMotion]);

  return enabled;
}
