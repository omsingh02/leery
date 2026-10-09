import { afterEach, describe, expect, it } from "vitest";
import { registerShakeTarget, shakeWriter } from "@/lib/fx/shakeTargets";

const el = () => ({ style: { transform: "" } }) as unknown as HTMLElement;
const frame = (x: string, y: string, r: string) => {
  shakeWriter.style.setProperty("--fx-sx", x);
  shakeWriter.style.setProperty("--fx-sy", y);
  shakeWriter.style.setProperty("--fx-sr", r);
};

describe("shake targets", () => {
  const offs: (() => void)[] = [];
  afterEach(() => {
    offs.splice(0).forEach((f) => f());
    frame("0px", "0px", "0deg");
  });

  it("move registered elements with one transform per frame, and rest when the shake ends", () => {
    const a = el();
    offs.push(registerShakeTarget(a));
    frame("3.20px", "-1.10px", "0.400deg");
    expect(a.style.transform).toBe("translate3d(3.20px, -1.10px, 0) rotate(0.400deg)");
    frame("0.00px", "0.00px", "0.000deg");
    expect(a.style.transform).toBe("");
  });

  it("opting out clears the transform and stops following", () => {
    const a = el();
    const off = registerShakeTarget(a);
    frame("5px", "5px", "1deg");
    expect(a.style.transform).not.toBe("");
    off();
    expect(a.style.transform).toBe("");
    frame("6px", "6px", "1deg");
    expect(a.style.transform).toBe("");
  });

  it("every registered element moves together; null registers nothing", () => {
    const a = el();
    const b = el();
    offs.push(registerShakeTarget(a), registerShakeTarget(b), registerShakeTarget(null));
    frame("2px", "0px", "0deg");
    expect(a.style.transform).toBe(b.style.transform);
    expect(a.style.transform).toContain("translate3d(2px");
  });
});
