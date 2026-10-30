// "R2", set in Archivo Expanded Bold. Two sizes: the sidebar and the
// signed-out pages.
export function R2Lockup({ size = "sm", className = "" }: { size?: "sm" | "lg"; className?: string }) {
  const lg = size === "lg";
  return (
    <div className={`flex items-end ${className}`}>
      <span className={`font-display leading-none tracking-tight ${lg ? "text-[2.75rem]" : "text-[1.375rem]"}`}>R2</span>
    </div>
  );
}
