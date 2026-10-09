import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { FxProvider } from "@/components/fx/FxProvider";
import { AppToaster } from "@/components/shell/AppToaster";
import { ConfigError } from "@/components/shell/ConfigError";
import { configured } from "@/lib/supabase";
import { sfx } from "@/lib/sound";
import { Home } from "@/pages/Home";
import { NotFound } from "@/pages/NotFound";
import { RoomPage } from "@/pages/RoomPage";

export default function App() {
  // Browsers only allow audio after a user gesture: unlock the synth on the first tap.
  useEffect(() => {
    const cleanup = () => {
      window.removeEventListener("pointerup", unlock);
      window.removeEventListener("keydown", unlock);
    };
    const unlock = () => {
      sfx.unlock();
      cleanup();
    };
    window.addEventListener("pointerup", unlock);
    window.addEventListener("keydown", unlock);
    return cleanup;
  }, []);

  return (
    <MotionConfig reducedMotion="user">
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
