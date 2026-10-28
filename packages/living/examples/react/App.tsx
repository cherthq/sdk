/** Minimal React living service. Bundle with any React toolchain; the page runtime has no React dependency. */
import { useEffect, useRef, useState } from 'react';
import { connectLivingPage, type LivingPage } from '@trychert/sdk/living';

type BoardState = { title: string; items: { name: string; done: boolean }[] };

/**
 * Connects once and exposes state plus a typed `send`. Mount this at the app root: unmounting disposes the
 * bridge, and the service then ends the session (StrictMode's dev double-mount is fine; it happens before connect).
 */
function useLivingService<S>(initial: S) {
  const [state, setState] = useState<S>(initial);
  const [live, setLive] = useState(false);
  const page = useRef<LivingPage | null>(null);
  useEffect(() => {
    const connection = connectLivingPage<S & {}>({
      onStart: start => { setState(start.state as S); setLive(true); },
      onState: next => setState(next as S),
      onStop: () => setLive(false),
    });
    page.current = connection;
    return () => connection.dispose();
  }, []);
  return { state, live, send: (message: string, data: Parameters<LivingPage['send']>[1] = null) => page.current?.send(message, data) };
}

export default function App() {
  const { state, live } = useLivingService<BoardState>({ title: 'Connecting…', items: [] });
  return (
    <main style={{ width: '100vw', height: '100vh', display: 'grid', placeContent: 'center', background: '#0f1115', color: '#f4f4f5', font: '600 44px system-ui' }}>
      <h1 style={{ margin: 0 }}>{state.title}</h1>
      <ul style={{ fontWeight: 400 }}>
        {state.items.map(item => <li key={item.name}>{item.done ? '✓' : '○'} {item.name}</li>)}
      </ul>
      {!live && <p style={{ color: '#a1a1aa', fontSize: 28 }}>Waiting for the call…</p>}
    </main>
  );
}
