import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { feel } from "@/lib/feel";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold no-select",
    "transition-[transform,filter,background-color,box-shadow,opacity] duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-45 active:scale-[0.97]",
  ],
  {
    variants: {
      variant: {
        /** Brand call-to-action (violet → pink glow). */
        primary: "bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-glow-primary hover:brightness-110",
        /** Frosted secondary. */
        secondary: "glass text-foreground hover:bg-white/10",
        ghost: "text-muted hover:bg-white/5 hover:text-foreground",
        /** "Call bluff!" — hot red. */
        bluff: "bg-gradient-to-br from-bluff to-rose-600 text-white shadow-glow-bluff hover:brightness-110",
        /** "Accept / I believe you" — mint. */
        trust: "border border-trust/40 bg-trust/15 text-trust hover:bg-trust/25",
        /** Winner / highlight — gold. */
        gold: "bg-gradient-to-br from-gold to-amber-500 text-ink shadow-glow-gold hover:brightness-110",
      },
      size: {
        sm: "h-9 px-4 text-sm",
        md: "h-11 px-6 text-sm",
        lg: "h-12 px-7 text-base",
        xl: "h-14 px-9 text-lg",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Shows a spinner and disables the button. */
  loading?: boolean;
  /** No press sound (for buttons that make their own). */
  silent?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, silent, children, type = "button", onPointerDown, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onPointerDown={(e) => {
        if (!silent && !disabled && !loading) feel.emit({ type: "ui.tap" });
        onPointerDown?.(e);
      }}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
