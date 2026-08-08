import type { CSSProperties, ReactNode } from "react";

/** Gradient badge used in workspace page headers, with a soft drifting aura. */
export default function PageHeaderIcon({
  gradient,
  children,
  className,
  style,
}: {
  gradient: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={`page-header-icon-aura shrink-0 ${className ?? ""}`} style={style}>
      <div
        className="page-header-icon grid h-9 w-9 place-items-center rounded-xl text-[#0b1410]"
        style={{ background: gradient }}
      >
        {children}
      </div>
    </span>
  );
}
