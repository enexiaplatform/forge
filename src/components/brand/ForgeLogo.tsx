/**
 * The Forge mark: an intent stroke and an execution stroke meeting the outcome
 * line, joined by an ember node — the commitment. Render it from here or from
 * public/favicon.svg; never set "FORGE" in a font as the logo.
 */
export function ForgeSymbol({ size = 28, onDark = true }: { size?: number; onDark?: boolean }) {
  const stroke = onDark ? '#F3F1EB' : '#1B1A18';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <g fill="none" stroke={stroke} strokeWidth="5.5" strokeLinecap="square">
        <path d="M46 11 V53" />
        <path d="M12 24 H36" />
        <path d="M12 40 H31" />
      </g>
      <rect x="33" y="16" width="16" height="16" fill="#C8673A" />
    </svg>
  );
}

/** The drawn wordmark: geometric capitals in strokes, not a typeface. */
export function ForgeWordmark({ height = 14, onDark = true }: { height?: number; onDark?: boolean }) {
  const c = onDark ? '#F3F1EB' : '#1B1A18';
  return (
    <svg height={height} viewBox="0 0 96 20" aria-label="Forge" role="img">
      <g fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="miter">
        <path d="M3 18 V2 H14 M3 10 H12" />
        <path d="M30 2 a8 8 0 1 0 0.01 0 Z" transform="translate(0 0)" />
        <path d="M45 18 V2 H52 a4.6 4.6 0 0 1 0 9.2 H45 M51 11.2 L57 18" />
        <path d="M80 4.5 A8 8 0 1 0 81 13 V10 H74" transform="translate(-6 0)" />
        <path d="M93 2 H83 V18 H93 M83 10 H91" />
      </g>
    </svg>
  );
}

export function ForgeLockup() {
  return (
    <div className="flex items-center gap-2.5">
      <ForgeSymbol size={26} />
      <ForgeWordmark height={13} />
    </div>
  );
}
