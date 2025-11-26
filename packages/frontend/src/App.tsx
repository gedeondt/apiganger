import { useEffect, useMemo, useState } from "react";
import "./App.css";

type SimulateResponse = {
  prompt?: string;
  promptSchema?: string;
  promptData?: string;
  result: unknown;
  executedSql?: string[];
  schema?: string;
  tableStats?: { table: string; rows: number }[];
  createSql?: string;
  alterSql?: string;
  dmlSql?: string;
  selectSql?: string;
  error?: string;
  message?: string;
  usingOpenAI: boolean;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

function App() {
  const [prompt, setPrompt] = useState("");
  const [savedPrompt, setSavedPrompt] = useState("");
  const [method, setMethod] = useState<"GET" | "POST" | "PUT" | "PATCH" | "DELETE">("GET");
  const [savedMethod, setSavedMethod] = useState<typeof method>("GET");
  const [endpoint, setEndpoint] = useState("/clients/75");
  const [savedEndpoint, setSavedEndpoint] = useState("/clients/75");
  const [schema, setSchema] = useState<string>("");
  const [samplePayload, setSamplePayload] = useState(
    JSON.stringify(
      {
        customer: {
          name: "Ada Lovelace",
          email: "ada@example.com",
          plan: "pro",
        },
        requestId: "req-123",
      },
      null,
      2,
    ),
  );
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [showAssembledPrompt, setShowAssembledPrompt] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPromptBox, setShowPromptBox] = useState(true);

  useEffect(() => {
    void loadPrompt();
  }, []);

  const promptDirty = useMemo(
    () =>
      prompt.trim() !== savedPrompt.trim() ||
      method !== savedMethod ||
      endpoint.trim() !== savedEndpoint.trim(),
    [prompt, savedPrompt, method, savedMethod, endpoint, savedEndpoint],
  );

  async function loadPrompt() {
    try {
      const res = await fetch(`${API_BASE}/api/prompt`);
      if (!res.ok) throw new Error(`Get prompt failed (${res.status})`);
      const data = (await res.json()) as { prompt?: string; method?: string; endpoint?: string };
      setPrompt(data.prompt ?? "");
      setSavedPrompt(data.prompt ?? "");
      setMethod((data.method as typeof method | undefined) ?? "GET");
      setSavedMethod((data.method as typeof method | undefined) ?? "GET");
      setEndpoint(data.endpoint ?? "/clients/75");
      setSavedEndpoint(data.endpoint ?? "/clients/75");
      setSchema(data.schema ?? "");
      setStatus("Prompt cargado");
    } catch (error) {
      setStatus(`Error cargando prompt: ${String(error)}`);
    }
  }

  async function savePrompt() {
    setStatus("Guardando prompt...");
    try {
      const res = await fetch(`${API_BASE}/api/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, method, endpoint }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const data = (await res.json()) as { prompt?: string; method?: string; endpoint?: string };
      setSavedPrompt(data.prompt ?? prompt);
      setSavedMethod((data.method as typeof method | undefined) ?? method);
      setSavedEndpoint(data.endpoint ?? endpoint);
      setSchema(data.schema ?? schema);
      setStatus("Prompt guardado");
    } catch (error) {
      setStatus(`Error guardando prompt: ${String(error)}`);
    }
  }

  async function generateScenario() {
    setLoading(true);
    setStatus("Generando escenario aleatorio...");
    try {
      const res = await fetch(`${API_BASE}/api/scenario`, { method: "POST" });
      const body = (await res.json()) as {
        prompt?: string;
        method?: string;
        endpoint?: string;
        payload?: unknown;
        schema?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        setStatus(body.error ?? body.message ?? `Error generando escenario (${res.status})`);
        return;
      }

      const scenarioPrompt = body.prompt ?? "";
      const scenarioMethod = (body.method as typeof method | undefined) ?? "POST";
      const scenarioEndpoint = body.endpoint ?? "/items";
      const scenarioPayload = body.payload ?? {};

      setPrompt(scenarioPrompt);
      setSavedPrompt(scenarioPrompt);
      setMethod(scenarioMethod);
      setSavedMethod(scenarioMethod);
      setEndpoint(scenarioEndpoint);
      setSavedEndpoint(scenarioEndpoint);
      setSamplePayload(JSON.stringify(scenarioPayload, null, 2));
      setSchema(body.schema ?? "");
      setResult(null);
      setStatus("Escenario cargado: listo para simular");
    } catch (error) {
      setStatus(`Error generando escenario: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function runSimulation() {
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(samplePayload);
    } catch (error) {
      setStatus(`JSON invalido: ${String(error)}`);
      return;
    }

    setLoading(true);
    setStatus("Simulando...");
    try {
      const res = await fetch(`${API_BASE}/api/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payload: parsedPayload,
          endpoint,
          method,
        }),
      });
      const body = (await res.json()) as Partial<SimulateResponse>;
      const success = res.ok;
      const parsed: SimulateResponse = {
        prompt: body.prompt ?? "",
        promptSchema: body.promptSchema ?? body.prompt,
        promptData: body.promptData ?? "",
        result: body.result ?? { error: body.error ?? body.message ?? "Sin respuesta" },
        executedSql: body.executedSql ?? [],
        schema: body.schema,
        tableStats: body.tableStats,
        createSql: body.createSql,
        alterSql: body.alterSql,
        dmlSql: body.dmlSql,
        selectSql: body.selectSql,
        error: body.error,
        message: body.message,
        usingOpenAI: body.usingOpenAI ?? false,
      };
      setResult(parsed);
      if (parsed.schema) setSchema(parsed.schema);
      if (success) {
        setStatus(parsed.usingOpenAI ? "Respuesta generada por OpenAI" : "Respuesta mock (sin API key)");
      } else {
        setStatus(parsed.error ?? parsed.message ?? `Error simulando (${res.status})`);
      }
    } catch (error) {
      setStatus(`Error simulando: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  async function resetAll() {
    setStatus("Reiniciando memoria y base...");
    try {
      const res = await fetch(`${API_BASE}/api/reset`, { method: "POST" });
      if (!res.ok) throw new Error(`Reset failed (${res.status})`);
      const data = (await res.json()) as { schema?: string };
      setSchema(data.schema ?? "");
      setResult(null);
      setStatus("Memoria y base reiniciadas");
    } catch (error) {
      setStatus(`Error reiniciando: ${String(error)}`);
    }
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">API Ganger</p>
          <h1>Simulador de endpoints con prompts</h1>
          <p className="lede">
            Define el comportamiento de la API con un prompt, envía un JSON y obtén una
            respuesta consistente.
          </p>
          <div className="actions">
            <button className="primary" onClick={runSimulation} disabled={loading}>
              {loading ? "Generando..." : "Simular ahora"}
            </button>
            <button className="ghost" onClick={loadPrompt} disabled={loading}>
              Recargar prompt
            </button>
            <button className="ghost danger" onClick={resetAll} disabled={loading}>
              Reiniciar memoria/DB
            </button>
            <button className="ghost" onClick={generateScenario} disabled={loading}>
              {loading ? "..." : "Generar escenario aleatorio"}
            </button>
          </div>
          {status ? <p className="status">{status}</p> : null}
        </div>
      </header>

      <main className="grid">
        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Prompt base</p>
              <h2>Contexto del sistema</h2>
              <p className="muted">
                Explica qué es el sistema (ERP, CRM, planificador de viajes). No hables del endpoint
                concreto.
              </p>
            </div>
            <div className="row gap">
              <button className="primary" onClick={savePrompt} disabled={!promptDirty || loading}>
                Guardar prompt
              </button>
            </div>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={12}
            spellCheck={false}
            className="textarea"
            placeholder="Ej: Describe un ERP que gestiona pedidos, inventario y facturación..."
          />
          {promptDirty ? <p className="muted">Cambios sin guardar.</p> : null}
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Petición</p>
              <h2>Endpoint y payload</h2>
              <p className="muted">Selecciona método, endpoint y payload JSON.</p>
            </div>
            <button className="ghost" onClick={runSimulation} disabled={loading}>
              {loading ? "..." : "Simular"}
            </button>
          </div>
          <label className="muted">Método HTTP</label>
          <div className="method-row">
            {(["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`chip ${method === m ? "chip--active" : ""}`}
                onClick={() => setMethod(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <label className="muted" htmlFor="endpoint">
            Endpoint (ruta relativa)
          </label>
          <input
            id="endpoint"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="input"
            placeholder="/clients/75"
          />
          <textarea
            value={samplePayload}
            onChange={(e) => setSamplePayload(e.target.value)}
            rows={12}
            spellCheck={false}
            className="textarea"
          />
        </section>

        <section className="card wide">
          <div className="card-header">
            <div>
              <p className="eyebrow">Salida</p>
              <h2>Respuesta generada</h2>
            </div>
            {result ? (
              <button
                className="ghost"
                type="button"
                onClick={() => setShowAssembledPrompt((v) => !v)}
              >
                {showAssembledPrompt ? "Ocultar prompt armado" : "Ver prompt armado"}
              </button>
            ) : null}
          </div>
          {result ? (
            <div className="output">
              {showAssembledPrompt ? (
                <>
                  <p className="muted">Prompt schema (create/alter)</p>
                  <pre>{result.promptSchema ?? "No prompt schema"}</pre>
                  <p className="muted">Prompt datos (dml/select)</p>
                  <pre>{result.promptData ?? "No prompt datos"}</pre>
                </>
              ) : null}
              {result.error || result.message ? (
                <>
                  <p className="muted">Error</p>
                  <pre>{result.error ?? result.message}</pre>
                </>
              ) : null}
              <p className="muted">Respuesta</p>
              <pre>{JSON.stringify(result.result, null, 2)}</pre>
              <p className="muted">SQL - CREATE</p>
              <pre>{result.createSql?.trim() ? result.createSql : "No CREATE devuelto"}</pre>
              <p className="muted">SQL - ALTER</p>
              <pre>{result.alterSql?.trim() ? result.alterSql : "No ALTER devuelto"}</pre>
              <p className="muted">SQL - DML (INSERT/UPDATE)</p>
              <pre>{result.dmlSql?.trim() ? result.dmlSql : "No DML devuelto"}</pre>
              <p className="muted">SQL - SELECT</p>
              <pre>{result.selectSql?.trim() ? result.selectSql : "No SELECT devuelto"}</pre>
              {result.tableStats?.length ? (
                <>
                  <p className="muted">Tablas y registros</p>
                  <pre>
                    {result.tableStats
                      .map((t) => `${t.table}: ${t.rows} registros`)
                      .join("\n")}
                  </pre>
                </>
              ) : null}
            </div>
          ) : (
            <p className="muted">Ejecuta una simulación para ver la respuesta.</p>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
