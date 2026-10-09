import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { FxProvider } from "@/components/fx/FxProvider";
import { AppToaster } from "@/components/shell/AppToaster";
import { ConfigError } from "@/components/shell/ConfigError";
import { usePrefs } from "@/lib/prefs";
import { configured } from "@/lib/supabase";
import { sfx } from "@/lib/sound";
import { Home } from "@/pages/Home";
import { NotFound } from "@/pages/NotFound";
import { RoomPage } from "@/pages/RoomPage";

const UNLOCK_EVENTS = ["pointerup", "touchend", "click", "keydown"] as const;

export default function App() {
  // Browsers only allow audio after a user gesture: build the synth while the first tap is down, unlock it on release.
  useEffect(() => {
    const cleanup = () => {
      window.removeEventListener("pointerdown", prepare, true);
      for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlock);
    };
    const prepare = () => {
      sfx.prepare();
      window.removeEventListener("pointerdown", prepare, true);
    };
    const unlock = () => {
      void sfx.unlock();
      cleanup();
    };
    window.addEventListener("pointerdown", prepare, true);
    // iOS Safari only counts some events as the gesture that unlocks audio: listen for all the likely ones.
    for (const type of UNLOCK_EVENTS) window.addEventListener(type, unlock);
    return cleanup;
  }, []);

  // Framer-motion follows the player's setting, and the OS's while on Auto.
  const { effects } = usePrefs();

  return (
    <MotionConfig reducedMotion={effects === "reduced" ? "always" : effects === "full" ? "never" : "user"}>
      <FxProvider>
        <AppToaster />
        {configured ? (
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/r/:code" element={<RoomPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        ) : (
          <ConfigError />
        )}
      </FxProvider>
    </MotionConfig>
  );
}
