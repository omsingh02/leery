/* eslint-disable react-refresh/only-export-components -- entry file, not a module */
/**
 * Dev harness for the app shell + pre/post-game screens. No backend needed.
 *
 *   /dev/shell.html?page=home
 *   /dev/shell.html?state=lobby-host            (any name from src/dev/fixtures.ts)
 *   /dev/shell.html?state=lobby-host&offline=1  (shows the reconnecting banner)
 *   /dev/shell.html?state=error-room_not_found | error-setup | error-network
 *   /dev/shell.html?page=notfound | splash | config | boundary
 *   add &long=1 to use 16-char names everywhere
 *   add &aurora=1 to preview the ambient background as intended (see report)
 *
 * Add `&rm=1` to emulate prefers-reduced-motion is done by the browser flag instead (see Playwright).
 */
import "@fontsource-variable/inter";
import "@fontsource-variable/unbounded";
import "@/index.css";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { FxProvider } from "@/components/fx/FxProvider";
import { AppToaster } from "@/components/shell/AppToaster";
import { ConfigError } from "@/components/shell/ConfigError";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { Splash } from "@/components/shell/Splash";
import { fakeController } from "@/dev/fakeController";
import { fixture, FIXTURE_NAMES, type FixtureName } from "@/dev/fixtures";
import type { RoomPreview, RoomView } from "@/lib/types";
import { ApiError } from "@/lib/api";
import { Home } from "@/pages/Home";
import { NotFound } from "@/pages/NotFound";
import { RoomScreens } from "@/pages/RoomScreens";

const params = new URLSearchParams(window.location.search);
const page = params.get("page");
const state = params.get("state");
const offline = params.get("offline") === "1";

// QA flag: emulate the proposed index.css fix (a transparent <body> lets the ambient aurora layers show).
if (params.get("aurora") === "1") {
  const style = document.createElement("style");
  style.textContent = "body{background:transparent!important}";
  document.head.appendChild(style);
}

/** `&long=1`: stress-test overflow with the widest possible names. */
function stress(data: RoomView | RoomPreview): RoomView | RoomPreview {
  if (params.get("long") !== "1") return data;
  const wide = "W".repeat(16);
  if ("preview" in data) return { ...data, host: wide };
  return { ...data, players: data.players.map((p, i) => (i === 1 || i === 3 ? { ...p, name: wide } : p)) };
}

function Bomb(): never {
  throw new Error("Harness: deliberate render crash");
}

function Body() {
  if (page === "home") return <Home />;
  if (page === "notfound") return <NotFound />;
  if (page === "splash") return <Splash />;
  if (page === "config") return <ConfigError />;
  if (page === "boundary") return <Bomb />;

  if (state?.startsWith("error-")) {
    const code = state.slice("error-".length) as ApiError["code"];
    const err = new ApiError(code);
    return <RoomScreens room={fakeController(fixture("lobby-host"), { error: err, view: null, preview: null })} />;
  }

  const name = (FIXTURE_NAMES as readonly string[]).includes(state ?? "") ? (state as FixtureName) : "lobby-host";
  return <RoomScreens room={fakeController(stress(fixture(name)), offline ? { connection: "offline" } : {})} />;
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <MotionConfig reducedMotion="user">
      <FxProvider>
        <AppToaster />
        <MemoryRouter>
          <Body />
        </MemoryRouter>
      </FxProvider>
    </MotionConfig>
  </ErrorBoundary>,
);
