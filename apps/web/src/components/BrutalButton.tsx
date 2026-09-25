import type { ButtonHTMLAttributes } from "react";

type Variant = "lime" | "magenta" | "cyan" | "ghost";

const variantClasses: Record<Variant, string> = {
  lime: "bg-lime text-black",
  magenta: "bg-magenta text-black",
  cyan: "bg-cyan text-black",
  ghost: "bg-transparent text-white",
};

export function BrutalButton({
  variant = "lime",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`font-display font-bold uppercase tracking-wide px-6 py-3 border-2 border-black shadow-brutal
        transition-transform duration-100 active:translate-x-[3px] active:translate-y-[3px] active:shadow-brutal-sm
        hover:-translate-y-0.5 hover:-translate-x-0.5
        ${variantClasses[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
