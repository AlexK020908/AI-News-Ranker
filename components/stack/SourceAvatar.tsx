"use client";

import type { MouseEvent } from "react";
import type { StackSource } from "@/lib/stack/types";

interface Props {
  source: StackSource;
  small?: boolean;
  onHover?: (e: MouseEvent<HTMLSpanElement>) => void;
  onLeave?: () => void;
}

export function SourceAvatar({ source, small, onHover, onLeave }: Props) {
  const sz = small ? 18 : 22;
  const textColor = source.text || "#fff";
  return (
    <span
      className="src"
      style={{
        background: source.color,
        color: textColor,
        width: sz,
        height: sz,
        fontSize: sz <= 18 ? 9 : 10,
        borderWidth: sz <= 18 ? 1.5 : 2,
      }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      title={source.name}
    >
      {source.initial}
    </span>
  );
}
