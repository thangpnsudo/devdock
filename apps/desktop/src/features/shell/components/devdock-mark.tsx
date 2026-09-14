interface DevDockMarkProps {
  size?: number;
}

export function DevDockMark({ size = 32 }: DevDockMarkProps): JSX.Element {
  return (
    <svg
      className="dd-brand-mark"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="DevDock"
    >
      <rect width="48" height="48" rx="14" fill="currentColor" />
      <path d="M14 30V18a4 4 0 0 1 4-4h2v20h-2a4 4 0 0 1-4-4Z" fill="#5272FF" />
      <path d="M22 34V12h4a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4h-4Z" fill="#F76B15" />
      <path d="M32 29V19a3 3 0 0 1 3-3h1v16h-1a3 3 0 0 1-3-3Z" fill="#BDEE63" />
    </svg>
  );
}
