import { toast } from "sonner";
import { feel } from "./feel";

/** An error toast with the matching "no" sound and buzz. */
export function notifyError(message: string): void {
  feel.emit({ type: "ui.error" });
  toast.error(message);
}
