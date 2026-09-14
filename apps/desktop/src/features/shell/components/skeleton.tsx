// Loading skeleton placeholders shown while data is being fetched.

import type { ReactNode } from 'react';

interface SkeletonProps {
  /** Width of the bar (CSS length, e.g. '60%'). */
  width?: string;
  /** Height of the bar (CSS length, e.g. '12px'). */
  height?: string;
  /** Additional class names. */
  className?: string;
  /** Optional children to render inside the skeleton container. */
  children?: ReactNode;
}

/** Single rounded placeholder bar. */
export function Skeleton({
  width = '100%',
  height = '12px',
  className,
  children,
}: SkeletonProps): JSX.Element {
  const cls = className ? `dd-skeleton ${className}` : 'dd-skeleton';
  return (
    <div className={cls} style={{ width, height }} aria-hidden="true">
      {children}
    </div>
  );
}

/** Stack of N skeleton rows (used by list pages). */
export function SkeletonList({ count = 3 }: { count?: number }): JSX.Element {
  return (
    <div className="dd-skeleton-list" role="status" aria-label="Loading content">
      <span className="dd-sr-only">Loading content…</span>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="dd-skeleton-list__item">
          <Skeleton width="40%" height="14px" />
          <Skeleton width="100%" height="20px" />
          <Skeleton width="80%" height="20px" />
        </div>
      ))}
    </div>
  );
}
