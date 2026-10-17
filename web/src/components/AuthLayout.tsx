import type { ReactNode } from "react";

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
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-4 bg-gray-50">
      <div className="w-full max-w-sm flex flex-col gap-4 card p-6 shadow-sm">
        <div className="flex flex-col items-center gap-2 mb-1 text-center">
          <img src="/favicon.svg" alt="" className="w-9 h-9 rounded-md" />
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
        {children}
      </div>
      {footer && <div className="text-sm text-gray-500 text-center">{footer}</div>}
    </div>
  );
}
