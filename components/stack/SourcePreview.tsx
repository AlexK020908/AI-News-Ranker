"use client";

import type { StackSource } from "@/lib/stack/types";
import { SourceAvatar } from "./SourceAvatar";
import { hoursAgoLabel } from "@/lib/stack/format";

interface Props {
  source: StackSource;
  x: number;
  y: number;
}

export function SourcePreview({ source, x, y }: Props) {
  return (
    <div className="src-preview" style={{ left: x, top: y }}>
      <div className="src-preview__src">
        <SourceAvatar source={source} small />
        <span>{source.name} · {hoursAgoLabel(source.hoursAgo)}</span>
      </div>
      <div>{source.headline}</div>
    </div>
  );
}
