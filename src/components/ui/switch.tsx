import * as React from "react";
import { cn } from "@/lib/utils";

interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** An on/off switch: the knob slides with a little overshoot, the track glows when on. */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(({ checked, onCheckedChange, className, disabled, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onCheckedChange(!checked)}
    className={cn(
      "relative h-7 w-12 shrink-0 rounded-full border transition-[background-color,border-color,box-shadow] duration-200 no-select",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.96]",
      checked ? "border-primary/60 bg-primary/70 shadow-[0_0_18px_hsl(var(--primary)/0.45)]" : "border-white/15 bg-white/10",
      className,
    )}
    {...props}
  >
    <span
      aria-hidden
      className="absolute left-0.5 top-0.5 h-[22px] w-[22px] rounded-full bg-white shadow-md"
      style={{ transform: `translateX(${checked ? 20 : 0}px)`, transition: "transform 260ms cubic-bezier(0.34, 1.56, 0.5, 1)" }}
    />
  </button>
));
Switch.displayName = "Switch";
