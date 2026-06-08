import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type AppStatus = {
  name: string;
  version: string;
  runtime: string;
  dev: boolean;
};

type GameDatabaseResult = {
  games: unknown[];
  total: number;
  matched: number;
  limited: boolean;
  source: string;
};

function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [database, setDatabase] = useState<GameDatabaseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStubs() {
      try {
        const [nextStatus, nextDatabase] = await Promise.all([
          invoke<AppStatus>("get_app_status"),
          invoke<GameDatabaseResult>("get_games"),
        ]);

        if (cancelled) return;
        setStatus(nextStatus);
        setDatabase(nextDatabase);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    }

    void loadStubs();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">PirateBox Tauri 2</p>
        <h1>Runtime separado criado</h1>
        <p>
          Esta shell valida React, Vite, Tauri 2 e os primeiros comandos Rust
          stub. O frontend real deve ser migrado a partir da camada
          <code> pirateboxApi</code> do app Electron.
        </p>
      </section>

      <section className="status-grid" aria-label="Estado dos stubs Tauri">
        <article>
          <span>Runtime</span>
          <strong>{status?.runtime ?? "carregando"}</strong>
        </article>
        <article>
          <span>Versao</span>
          <strong>{status?.version ?? "0.1.0"}</strong>
        </article>
        <article>
          <span>Catalogo</span>
          <strong>{database ? `${database.total} jogos` : "stub"}</strong>
        </article>
        <article>
          <span>Fonte</span>
          <strong>{database?.source ?? "tauri-stub"}</strong>
        </article>
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  );
}

export default App;
