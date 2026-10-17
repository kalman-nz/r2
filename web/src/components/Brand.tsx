// The Kalman wordmark, traced from the brand guidelines' own vector artwork
// (never re-typed in a font). Orange K, the rest in the current text colour.
// The guide's minimum on screen is a 16 px cap height, which is the height
// of this SVG.
export function KalmanWordmark({ height = 16, oneColour = false, className = "" }: { height?: number; oneColour?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 561.09 100" height={height} className={className} role="img" aria-label="Kalman" fill="currentColor">
      <path fill={oneColour ? "currentColor" : "#FF5B14"} d="M0.00 100.00L0.00 0.00L19.04 0.00L19.04 100.00L0.00 100.00M80.16 100.00L73.23 100.00L28.05 50.00L73.23 0.00L80.16 0.00L80.16 20.71L53.69 50.00L80.16 79.29L80.16 100.00Z" />
      <path d="M121.48 76.00L113.29 100.00L93.18 100.00L127.28 0.00L147.26 0.00L167.66 59.85L173.17 76.00L181.35 100.00L161.24 100.00L153.06 76.00L121.48 76.00M137.27 29.67L126.98 59.85L147.56 59.85L137.27 29.67M194.38 81.00L194.38 0.00L213.41 0.00L213.41 81.00L258.50 81.00L258.50 100.00L213.41 100.00L194.38 100.00L194.38 81.00M345.67 100.00L345.67 13.30L314.61 97.50L283.55 13.30L283.55 100.00L264.51 100.00L264.51 0.00L298.93 0.00L314.61 42.50L330.29 0.00L364.71 0.00L364.71 100.00L345.67 100.00M406.03 76.00L397.84 100.00L377.73 100.00L411.82 0.00L431.82 0.00L452.22 59.85L457.72 76.00L465.90 100.00L445.79 100.00L437.61 76.00L406.03 76.00M421.82 29.67L411.53 59.85L432.11 59.85L421.82 29.67M527.45 100.00L497.96 15.90L497.96 100.00L478.93 100.00L478.93 0.00L512.56 0.00L542.05 84.10L542.05 0.00L561.09 0.00L561.09 100.00L527.45 100.00Z" />
    </svg>
  );
}

// "R2 by Kalman": the product name set in Archivo Expanded Bold, then the
// maker's wordmark. Two sizes: the sidebar and the signed-out pages.
export function R2Lockup({ size = "sm", className = "" }: { size?: "sm" | "lg"; className?: string }) {
  const lg = size === "lg";
  return (
    <div className={`flex items-end gap-2.5 ${className}`}>
      <span className={`font-display leading-none tracking-tight ${lg ? "text-[2.75rem]" : "text-[1.375rem]"}`}>R2</span>
      <span className={`flex items-center gap-1.5 ${lg ? "pb-1" : "pb-px"}`}>
        <span className="eyebrow opacity-60">by</span>
        <KalmanWordmark height={lg ? 18 : 16} />
      </span>
    </div>
  );
}
