import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/literata';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './styles.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { applyLook, storedLook } from './ui/looks';

// The look is painted before anything renders, so the app never flashes in another one (ADR-064).
applyLook(storedLook());

let applyUpdate: () => void = () => {};
const listeners = new Set<() => void>();
const updateSW = registerSW({
  onNeedRefresh() {
    applyUpdate = () => void updateSW(true);
    listeners.forEach((l) => l());
  },
});

function Root() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const l = () => setReady(true);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return <App updateReady={ready} applyUpdate={() => applyUpdate()} />;
}

// Ask once for durable storage; browsers grant it by their own heuristics (no prompt on iOS).
void navigator.storage?.persist?.();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
