import type { ReactNode } from "react";
import { R2Lockup } from "./Brand";

// The centred card the signed-out pages share (sign in, sign up, links
// from emails).
export default function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-4 bg-paper">
      <R2Lockup size="lg" className="text-gray-900" />
      <div className="w-full max-w-sm flex flex-col gap-4 card p-6 shadow-sm">
        <div className="flex flex-col items-center gap-1.5 mb-1 text-center">
          <h1 className="text-xl text-gray-900">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
        {children}
      </div>
      {footer && <div className="text-sm text-gray-500 text-center">{footer}</div>}
    </div>
  );
}
