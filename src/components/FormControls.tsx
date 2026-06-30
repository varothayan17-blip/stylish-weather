import type { CSSProperties, ReactNode } from "react";

export function Section({
  title,
  subtitle,
  children,
  delay,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <section
      className="mb-8 animate-fade-up"
      style={delay != null ? ({ animationDelay: `${delay}ms` } as CSSProperties) : undefined}
    >
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="mb-3 text-xs text-muted-foreground">{subtitle}</p>}
      {children}
    </section>
  );
}

export function Grid({ children, cols = 3 }: { children: ReactNode; cols?: 2 | 3 }) {
  return (
    <div className={`grid gap-2 ${cols === 2 ? "grid-cols-2" : "grid-cols-3"}`}>{children}</div>
  );
}

export function Choice({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`glass-card flex flex-col items-center gap-2 rounded-2xl px-2 py-4 text-xs font-medium transition-all active:scale-95 ${
        active ? "ring-2 ring-primary text-primary" : "text-foreground/80"
      }`}
    >
      <span className={active ? "text-primary" : "text-muted-foreground"}>{icon}</span>
      <span className="text-center leading-tight">{label}</span>
    </button>
  );
}
