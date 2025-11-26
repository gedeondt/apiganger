import "dotenv/config";
import Fastify from "fastify";
import { OpenAI } from "openai";
import Database from "better-sqlite3";

type PromptState = {
  storedPrompt: string;
  genericPrompt: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  endpoint: string;
};

const defaultGenericPrompt = process.env.DEFAULT_GENERIC_PROMPT?.trim();
const defaultStoredPrompt = process.env.DEFAULT_STORED_PROMPT?.trim();

const promptState: PromptState = {
  genericPrompt:
    defaultGenericPrompt ??
    "You are an API simulator. Return JSON only. Respect HTTP semantics, validate input, and shape responses to match the described endpoint.",
  storedPrompt:
    defaultStoredPrompt ??
    "You are an ERP system. Manage products, customers, orders, invoices, and inventory with proper validation and consistent identifiers.",
  method: "POST",
  endpoint: "/clients/75",
};

const port = Number(process.env.PORT ?? 40000);
const openaiKey = process.env.OPENAI_API_KEY?.trim();
const openaiEnabled = Boolean(openaiKey);
const openai = openaiEnabled ? new OpenAI({ apiKey: openaiKey }) : null;

let db = createDatabase();
const fastify = Fastify({
  logger: true,
});

fastify.get("/api/health", async () => ({
  status: "ok",
  hasOpenAIKey: openaiEnabled,
}));

fastify.get("/api/prompt", async () => ({
  prompt: promptState.storedPrompt,
  method: promptState.method,
  endpoint: promptState.endpoint,
  hasOpenAIKey: openaiEnabled,
  schema: currentSchemaSnapshot(),
}));

fastify.post("/api/prompt", async (request, reply) => {
  const body = request.body as { prompt?: unknown; method?: unknown; endpoint?: unknown };
  const method = normalizeMethod(body?.method);
  const endpoint = normalizeEndpoint(body?.endpoint);
  if (typeof body?.prompt !== "string" || body.prompt.trim() === "") {
    return reply
      .code(400)
      .send({ message: "Body must include non-empty string 'prompt' field." });
  }
  if (!method) {
    return reply
      .code(400)
      .send({ message: "Body must include method in GET|POST|PUT|PATCH|DELETE" });
  }
  if (!endpoint) {
    return reply.code(400).send({ message: "Body must include non-empty endpoint path" });
  }

  promptState.storedPrompt = body.prompt.trim();
  promptState.method = method;
  promptState.endpoint = endpoint;
  return {
    prompt: promptState.storedPrompt,
    method: promptState.method,
    endpoint: promptState.endpoint,
  };
});

fastify.post("/api/scenario", async (_request, reply) => {
  if (!openaiEnabled || !openai) {
    return reply.code(400).send({ message: "OPENAI_API_KEY is required to generate a scenario" });
  }

  db = createDatabase();
  try {
    const scenario = await generateScenario();
    const method = normalizeMethod(scenario.method) ?? "POST";
    const endpoint = normalizeEndpoint(scenario.endpoint) ?? "/items";
    const payload = normalizePayload(scenario.samplePayload ?? scenario.payload);
    const context =
      typeof scenario.context === "string" && scenario.context.trim()
        ? scenario.context.trim()
        : promptState.storedPrompt;

    promptState.storedPrompt = context;
    promptState.method = method;
    promptState.endpoint = endpoint;

    return {
      prompt: promptState.storedPrompt,
      method,
      endpoint,
      payload,
      schema: currentSchemaSnapshot(),
    };
  } catch (error) {
    request.log.error({ err: error }, "Scenario generation failed");
    return reply.code(500).send({ message: "Failed to generate scenario", error: String(error) });
  }
});

fastify.post("/api/simulate", async (request, reply) => {
  const body = request.body as { payload?: unknown };
  const payload = (body?.payload ?? body) as unknown;
  const method = normalizeMethod((body as any)?.method) ?? promptState.method;
  const endpoint = normalizeEndpoint((body as any)?.endpoint) ?? promptState.endpoint;

  const schemaPrompt = buildSchemaPrompt(payload, method, endpoint);
  let dataPrompt = "";
  let schemaResult: {
    executedSql: string[];
    createSql: string;
    alterSql: string;
    tableStats: { table: string; rows: number }[];
  } | null = null;
  let dataResult: {
    executedSql: string[];
    response: unknown;
    tableStats: { table: string; rows: number }[];
    dmlSql: string;
    selectSql: string;
  } | null = null;

  try {
    const schemaCompletion = await generateCompletion(schemaPrompt);
    schemaResult = runSchemaSql(schemaCompletion);
    dataPrompt = buildDataPrompt(payload, method, endpoint);
  } catch (error) {
    const isSqlError =
      (error as any)?.code === "SQLITE_ERROR" || (error as any)?.name === "SqliteError";
    const status = isSqlError ? 400 : 500;
    request.log.error({ err: error }, isSqlError ? "Schema SQL failed" : "Schema generation failed");
    const body: Record<string, unknown> = {
      message: isSqlError ? "Schema SQL failed" : "Schema generation failed",
      error: String(error),
      promptSchema: schemaPrompt,
      createSql: (error as any)?.createSql,
      alterSql: (error as any)?.alterSql,
      executedSql: (error as any)?.executedSql,
    };
    return reply.code(status).send(body);
  }

  try {
    const dataCompletion = await generateCompletion(dataPrompt);
    dataResult = runDataSql(dataCompletion);
  } catch (error) {
    const isSqlError =
      (error as any)?.code === "SQLITE_ERROR" || (error as any)?.name === "SqliteError";
    const status = isSqlError ? 400 : 500;
    request.log.error({ err: error }, isSqlError ? "DML/Select SQL failed" : "Data generation failed");
    const body: Record<string, unknown> = {
      message: isSqlError ? "DML/Select SQL failed" : "Data generation failed",
      error: String(error),
      promptSchema: schemaPrompt,
      promptData: dataPrompt,
      createSql: schemaResult?.createSql,
      alterSql: schemaResult?.alterSql,
      dmlSql: (error as any)?.dmlSql,
      selectSql: (error as any)?.selectSql,
      executedSql: [
        ...(schemaResult?.executedSql ?? []),
        ...(((error as any)?.executedSql as string[] | undefined) ?? []),
      ],
    };
    return reply.code(status).send(body);
  }

  try {
    const executedSql = [...(schemaResult?.executedSql ?? []), ...(dataResult?.executedSql ?? [])];

    return {
      promptSchema: schemaPrompt,
      promptData: dataPrompt,
      result: dataResult?.response,
      executedSql,
      createSql: schemaResult?.createSql,
      alterSql: schemaResult?.alterSql,
      dmlSql: dataResult?.dmlSql,
      selectSql: dataResult?.selectSql,
      schema: currentSchemaSnapshot(),
      tableStats: dataResult?.tableStats ?? schemaResult?.tableStats,
      usingOpenAI: openaiEnabled,
    };
  } catch (error) {
    const isSqlError =
      (error as any)?.code === "SQLITE_ERROR" || (error as any)?.name === "SqliteError";
    const status = isSqlError ? 400 : 500;
    request.log.error({ err: error }, isSqlError ? "SQL execution failed" : "Simulation failed");
    const body: Record<string, unknown> = {
      message: isSqlError ? "SQL execution failed" : "Failed to generate response",
      error: String(error),
      promptSchema: schemaPrompt,
      promptData: dataPrompt,
      createSql: schemaResult?.createSql ?? (error as any)?.createSql,
      alterSql: schemaResult?.alterSql ?? (error as any)?.alterSql,
      dmlSql: dataResult?.dmlSql ?? (error as any)?.dmlSql,
      selectSql: dataResult?.selectSql ?? (error as any)?.selectSql,
      executedSql: [
        ...(schemaResult?.executedSql ?? []),
        ...(dataResult?.executedSql ?? []),
        ...(((error as any)?.executedSql as string[] | undefined) ?? []),
      ],
    };
    return reply.code(status).send(body);
  }
});

function buildSchemaPrompt(
  payload: unknown,
  method: PromptState["method"],
  endpoint: string,
): string {
  const payloadText =
    payload === undefined
      ? "No body provided."
      : JSON.stringify(payload, null, 2);

  const { schemaText, tableStats } = schemaWithStats();

  return [
    promptState.genericPrompt,
    `HTTP method: ${method}`,
    `Endpoint path: ${endpoint}`,
    `Context description: ${promptState.storedPrompt}`,
    `Current schema:\n${schemaText || "No tables yet."}`,
    tableStats ? `Row counts:\n${tableStats}` : "Row counts: none.",
    "Incoming request JSON:",
    payloadText,
    [
      "Prepare ONLY schema statements to support this request.",
      'Return a JSON object: { "create": "CREATE TABLE ...", "alter": "ALTER TABLE ... ADD COLUMN ..."}',
      "- Always include keys create and alter; if not needed, return an empty string for that key.",
      "- Do NOT reference tables that are not in the provided schema; create them first with CREATE TABLE IF NOT EXISTS before any other statement.",
      "- Do NOT recreate tables that already exist; prefer CREATE TABLE IF NOT EXISTS or skip creation.",
      "- Compare the table schema against the request payload; add missing columns with ALTER TABLE ... ADD COLUMN.",
      "- Do NOT include INSERT/UPDATE/DELETE/SELECT here.",
      "- Use valid SQLite syntax. Do not include explanations or extra fields.",
    ].join("\n"),
  ].join("\n\n");
}

function buildDataPrompt(
  payload: unknown,
  method: PromptState["method"],
  endpoint: string,
): string {
  const payloadText =
    payload === undefined
      ? "No body provided."
      : JSON.stringify(payload, null, 2);

  const { schemaText, tableStats } = schemaWithStats();

  return [
    promptState.genericPrompt,
    `HTTP method: ${method}`,
    `Endpoint path: ${endpoint}`,
    `Context description: ${promptState.storedPrompt}`,
    `Current schema (post schema-prep):\n${schemaText || "No tables yet."}`,
    tableStats ? `Row counts:\n${tableStats}` : "Row counts: none.",
    "Incoming request JSON:",
    payloadText,
    [
      "Return ONLY a JSON object with these keys (all lowercase):",
      '{ "dml": "INSERT/UPDATE/DELETE ...", "select": "SELECT ... FROM ..." }',
      "- The backend will execute them in order: dml, select. The select is mandatory.",
      "- Always include both keys; if dml is not needed, return an empty string for that key.",
      "- Do NOT include CREATE or ALTER in this step. Assume schema is already prepared.",
      "- Do NOT reference tables that are not in the provided schema.",
      "- Use the schema/row counts to decide when to INSERT new rows or UPDATE existing ones.",
      "- The SELECT must return the API response JSON (as rows) at the end.",
      "- Use valid SQLite syntax. Do not include explanations or extra fields.",
    ].join("\n"),
  ].join("\n\n");
}

async function generateCompletion(promptText: string) {
  if (!openaiEnabled || !openai) {
    throw new Error("OPENAI_API_KEY is not set in backend environment");
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an API simulator. Respond only with valid JSON. Do not include explanations.",
      },
      { role: "user", content: promptText },
    ],
  });

  const content = response.choices[0]?.message?.content?.trim() ?? "{}";
  try {
    return JSON.parse(content);
  } catch {
    // If model returns plain SQL string list without JSON wrapper, try to wrap.
    if (content.startsWith("[") && content.endsWith("]")) {
      try {
        return JSON.parse(content);
      } catch {
        /* ignore */
      }
    }
    return { sql: [], response: null, raw: content };
  }
}

fastify.setErrorHandler((error, _request, reply) => {
  fastify.log.error(error);
  reply
    .code(500)
    .send({ message: "Unexpected server error", error: error.message });
});

fastify.post("/api/reset", async () => {
  db = createDatabase();
  return { status: "reset", schema: currentSchemaSnapshot() };
});

function createDatabase() {
  const database = new Database(":memory:");
  database.pragma("journal_mode = WAL");
  return database;
}

function currentSchemaSnapshot(): string {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name as string);

  if (!tables.length) return "";

  const parts: string[] = [];
  for (const table of tables) {
    const columns = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((col) => `${col.name} ${col.type}${col.notnull ? " NOT NULL" : ""}`)
      .join(", ");
    parts.push(`${table}: ${columns}`);
  }
  return parts.join("\n");
}

function runSchemaSql(completion: unknown): {
  executedSql: string[];
  tableStats: { table: string; rows: number }[];
  createSql: string;
  alterSql: string;
} {
  const executedSql: string[] = [];
  let createSql = "";
  let alterSql = "";

  const sqlStatements: string[] = (() => {
    if (
      completion &&
      typeof completion === "object" &&
      !Array.isArray(completion) &&
      ("create" in (completion as any) || "alter" in (completion as any))
    ) {
      const create =
        typeof (completion as any).create === "string" ? (completion as any).create.trim() : "";
      const alter =
        typeof (completion as any).alter === "string" ? (completion as any).alter.trim() : "";
      createSql = create;
      alterSql = alter;
      const list: string[] = [];
      if (create) list.push(create);
      if (alter) list.push(alter);
      return list;
    }

    if (Array.isArray((completion as any))) {
      return (completion as any).filter((s: unknown) => typeof s === "string");
    }

    if (Array.isArray((completion as any)?.sql)) {
      return (completion as any).sql.filter((s: unknown) => typeof s === "string");
    }

    return [];
  })();

  const tx = db.transaction((statements: string[]) => {
    statements.forEach((stmt) => {
      const trimmed = stmt.trim();
      if (!trimmed) return;
      db.exec(trimmed);
      executedSql.push(trimmed);
    });
  });

  try {
    if (sqlStatements.length) {
      tx(sqlStatements);
    }
  } catch (err) {
    (err as any).executedSql = [...executedSql];
    (err as any).createSql = createSql;
    (err as any).alterSql = alterSql;
    throw err;
  }

  return { executedSql, tableStats: getTableStats(), createSql, alterSql };
}

function runDataSql(completion: unknown): {
  executedSql: string[];
  response: unknown;
  tableStats: { table: string; rows: number }[];
  dmlSql: string;
  selectSql: string;
} {
  const executedSql: string[] = [];
  let lastSelectResult: unknown = null;
  let dmlSql = "";
  let selectSql = "";

  const sqlStatements: string[] = (() => {
    if (
      completion &&
      typeof completion === "object" &&
      !Array.isArray(completion) &&
      ("dml" in (completion as any) || "select" in (completion as any))
    ) {
      const dml = typeof (completion as any).dml === "string" ? (completion as any).dml.trim() : "";
      const select =
        typeof (completion as any).select === "string" ? (completion as any).select.trim() : "";
      dmlSql = dml;
      selectSql = select;
      const list: string[] = [];
      if (dml) list.push(dml);
      if (select) list.push(select);
      return list;
    }

    if (Array.isArray((completion as any))) {
      return (completion as any).filter((s: unknown) => typeof s === "string");
    }

    if (Array.isArray((completion as any)?.sql)) {
      return (completion as any).sql.filter((s: unknown) => typeof s === "string");
    }

    return [];
  })();

  if (!sqlStatements.length) {
    throw new Error("No SQL generated");
  }
  const lastStmt = sqlStatements[sqlStatements.length - 1]?.trim() ?? "";
  if (!/^select/i.test(lastStmt)) {
    throw new Error("Last SQL must be SELECT");
  }
  if (!selectSql) {
    selectSql = lastStmt;
  }

  const tx = db.transaction((statements: string[]) => {
    statements.forEach((stmt, idx) => {
      const trimmed = stmt.trim();
      if (!trimmed) return;
      const isSelect = idx === statements.length - 1;
      const runStatement = () => {
        if (isSelect) {
          const rows = db.prepare(trimmed).all();
          lastSelectResult = rows;
        } else {
          db.exec(trimmed);
        }
        executedSql.push(trimmed);
      };

      runStatement();
    });
  });

  try {
    if (sqlStatements.length) {
      tx(sqlStatements);
    }
  } catch (err) {
    (err as any).executedSql = [...executedSql];
    (err as any).dmlSql = dmlSql;
    (err as any).selectSql = selectSql;
    throw err;
  }

  return {
    executedSql,
    response: lastSelectResult,
    tableStats: getTableStats(),
    dmlSql,
    selectSql,
  };
}

function normalizeMethod(method: unknown): PromptState["method"] | null {
  if (typeof method !== "string") return null;
  const upper = method.toUpperCase();
  if (
    upper === "GET" ||
    upper === "POST" ||
    upper === "PUT" ||
    upper === "PATCH" ||
    upper === "DELETE"
  ) {
    return upper;
  }
  return null;
}

function normalizeEndpoint(endpoint: unknown): string | null {
  if (typeof endpoint !== "string") return null;
  const cleaned = endpoint.trim();
  if (!cleaned) return null;
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function getTableStats(): { table: string; rows: number }[] {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => row.name as string);
  const stats: { table: string; rows: number }[] = [];
  for (const table of tables) {
    const count = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
    stats.push({ table, rows: count.c });
  }
  return stats;
}

function formatTableStats(stats: { table: string; rows: number }[]): string {
  if (!stats.length) return "";
  return stats.map((s) => `${s.table}: ${s.rows} rows`).join("\n");
}

function normalizePayload(payload: unknown): unknown {
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return { value: payload };
    }
  }
  return payload;
}

async function generateScenario(): Promise<{
  context: string;
  endpoint: string;
  method: string;
  samplePayload: unknown;
  payload?: unknown;
}> {
  if (!openaiEnabled || !openai) {
    throw new Error("OPENAI_API_KEY is required");
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.8,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You invent random business API scenarios. Respond ONLY with JSON using the required keys.",
      },
      {
        role: "user",
        content: [
          "Generate a random business API scenario with a brief context, a REST endpoint, method, and a realistic sample payload.",
          'Respond as JSON: { "context": "...", "endpoint": "/...", "method": "POST", "samplePayload": { ... } }',
          "- Context should describe the system (ERP, hotel bookings, hospital agenda, fleet tracking, CRM, etc.).",
          "- Keep it concise (2-3 sentences) and in present tense.",
          "- Endpoint should be a POST or PATCH when it makes sense; prefer POST. Path should include a plural noun.",
          "- Payload should be valid JSON with 3-8 fields, realistic types (ids, strings, dates, numbers).",
          "- Do NOT include explanations, markdown, or extra keys.",
        ].join("\n"),
      },
    ],
  });

  const content = response.choices[0]?.message?.content?.trim() ?? "{}";
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse scenario JSON: ${String(error)}`);
  }
}

function schemaWithStats(): { schemaText: string; tableStats: string } {
  const schemaText = currentSchemaSnapshot();
  const tableStats = formatTableStats(getTableStats());
  return { schemaText, tableStats };
}

fastify
  .listen({ port, host: "127.0.0.1" })
  .then(() => {
    fastify.log.info(`Backend running on http://localhost:${port}`);
  })
  .catch((err) => {
    fastify.log.error(err);
    process.exit(1);
  });
