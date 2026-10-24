import cors from "cors";
import express from "express";

import { pool } from "./db.js";
import { getResource, resources } from "./resources.js";

export const app = express();

const allowedOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

app.disable("x-powered-by");
app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", async (_request, response, next) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.get("/api/chat/status", (_request, response) => {
  response.json({ configured: Boolean(process.env.N8N_CHAT_WEBHOOK_URL?.trim()) });
});

app.post("/api/chat", async (request, response, next) => {
  try {
    const webhookUrl = process.env.N8N_CHAT_WEBHOOK_URL?.trim();
    if (!webhookUrl) {
      return response.status(503).json({
        error: "El workflow de n8n todavía no está enlazado. Revisa n8n/README.md.",
      });
    }

    const { message, sessionId } = request.body || {};
    if (typeof message !== "string" || !message.trim() || message.length > 2000) {
      return response.status(400).json({ error: "Escribe una consulta de hasta 2000 caracteres." });
    }
    if (typeof sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(sessionId)) {
      return response.status(400).json({ error: "La sesión de chat no tiene un identificador válido." });
    }

    let target;
    try {
      target = new URL(webhookUrl);
    } catch {
      return response.status(500).json({ error: "N8N_CHAT_WEBHOOK_URL no contiene una URL válida." });
    }
    if (!["http:", "https:"].includes(target.protocol)) {
      return response.status(500).json({ error: "La URL del webhook debe usar HTTP o HTTPS." });
    }

    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sendMessage",
        sessionId,
        chatInput: message.trim(),
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!upstream.ok) {
      return response.status(502).json({
        error: "n8n respondió con un error. Revisa que el workflow esté activo y que sus credenciales funcionen.",
      });
    }

    const payload = await upstream.json().catch(() => null);
    const reply = extractChatReply(payload);
    if (!reply) {
      return response.status(502).json({ error: "n8n no devolvió una respuesta de texto." });
    }
    response.json({ reply });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return response.status(504).json({ error: "La consulta tardó demasiado. Inténtalo de nuevo." });
    }
    next(error);
  }
});

app.get("/api/dashboard", async (_request, response, next) => {
  try {
    const counts = {};
    await Promise.all(
      Object.entries(resources).map(async ([name]) => {
        const result = await pool.query(`SELECT COUNT(*)::int AS total FROM "${name}"`);
        counts[name] = result.rows[0].total;
      }),
    );

    const [stockResult, declarationStates, inspectionResults, retainedResult, movementResult, monthlyMovements, recentDeclarations] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(cantidad), 0)::int AS total_stock,
          COALESCE(SUM(cantidad) FILTER (WHERE estado = $1), 0)::int AS retained_stock,
          COALESCE(SUM(cantidad) FILTER (WHERE estado = $2), 0)::int AS released_stock
        FROM inventario
      `, ["Retenido", "Liberado"]),
      pool.query(`
        SELECT estado, COUNT(*)::int AS total
        FROM declaracion
        GROUP BY estado
      `),
      pool.query(`
        SELECT resultado, COUNT(*)::int AS total
        FROM inspeccion
        GROUP BY resultado
      `),
      pool.query(`
        SELECT i.id_inventario, p.descripcion AS producto, b.nombre AS bodega,
               i.cantidad, i.fecha_ingreso, i.estado
        FROM inventario i
        JOIN producto p ON p.id_producto = i.id_producto
        JOIN bodega b ON b.id_bodega = i.id_bodega
        WHERE i.estado = $1
        ORDER BY i.fecha_ingreso DESC, i.id_inventario DESC
        LIMIT 6
      `, ["Retenido"]),
      pool.query(`
        SELECT m.id_movimiento, m.tipo, m.fecha, m.cantidad,
               p.descripcion AS producto, b.nombre AS bodega
        FROM movimiento_inventario m
        LEFT JOIN producto p ON p.id_producto = m.id_producto
        LEFT JOIN bodega b ON b.id_bodega = m.id_bodega
        ORDER BY m.fecha DESC NULLS LAST, m.id_movimiento DESC
        LIMIT 6
      `),
      pool.query(`
        SELECT to_char(date_trunc('month', fecha), 'YYYY-MM') AS periodo,
               tipo, COALESCE(SUM(cantidad), 0)::int AS cantidad,
               COUNT(*)::int AS movimientos
        FROM movimiento_inventario
        WHERE fecha IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1, 2
      `),
      pool.query(`
        SELECT d.id_declaracion, d.numero, d.fecha, d.regimen, d.estado,
               i.razon_social AS importador, p.nombre AS pais_origen
        FROM declaracion d
        LEFT JOIN importador i ON i.id_importador = d.id_importador
        LEFT JOIN pais p ON p.id_pais = d.id_pais_origen
        ORDER BY d.fecha DESC NULLS LAST, d.id_declaracion DESC
        LIMIT 6
      `),
    ]);

    response.json({
      counts,
      ...stockResult.rows[0],
      declaration_states: declarationStates.rows,
      inspection_results: inspectionResults.rows,
      retained_inventory: retainedResult.rows,
      recent_movements: movementResult.rows,
      monthly_movements: monthlyMovements.rows,
      recent_declarations: recentDeclarations.rows,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/:resource", async (request, response, next) => {
  try {
    const resource = getResource(request.params.resource);
    const parsedLimit = Number.parseInt(request.query.limit ?? "200", 10);
    const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 200;
    const columns = [resource.primaryKey, ...resource.fields].map(quoteIdentifier).join(", ");
    const result = await pool.query(
      `SELECT ${columns} FROM "${request.params.resource}" ORDER BY "${resource.primaryKey}" LIMIT $1`,
      [limit],
    );
    response.json(result.rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/:resource/:id", async (request, response, next) => {
  try {
    const resource = getResource(request.params.resource);
    const id = parseId(request.params.id);
    const columns = [resource.primaryKey, ...resource.fields].map(quoteIdentifier).join(", ");
    const result = await pool.query(
      `SELECT ${columns} FROM "${request.params.resource}" WHERE "${resource.primaryKey}" = $1`,
      [id],
    );
    if (!result.rowCount) return response.status(404).json({ error: "Registro no encontrado." });
    response.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.post("/api/:resource", async (request, response, next) => {
  try {
    const resource = getResource(request.params.resource);
    const values = validatePayload(request.body, resource.fields);
    const columns = Object.keys(values);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
    const result = await pool.query(
      `INSERT INTO "${request.params.resource}" (${columns.map(quoteIdentifier).join(", ")}) ` +
        `VALUES (${placeholders}) RETURNING ${[resource.primaryKey, ...resource.fields].map(quoteIdentifier).join(", ")}`,
      Object.values(values),
    );
    response.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.put("/api/:resource/:id", async (request, response, next) => {
  try {
    const resource = getResource(request.params.resource);
    const id = parseId(request.params.id);
    const values = validatePayload(request.body, resource.fields);
    const columns = Object.keys(values);
    const assignments = columns.map((column, index) => `${quoteIdentifier(column)} = $${index + 1}`).join(", ");
    const result = await pool.query(
      `UPDATE "${request.params.resource}" SET ${assignments} ` +
        `WHERE "${resource.primaryKey}" = $${columns.length + 1} ` +
        `RETURNING ${[resource.primaryKey, ...resource.fields].map(quoteIdentifier).join(", ")}`,
      [...Object.values(values), id],
    );
    if (!result.rowCount) return response.status(404).json({ error: "Registro no encontrado." });
    response.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/:resource/:id", async (request, response, next) => {
  try {
    const resource = getResource(request.params.resource);
    const id = parseId(request.params.id);
    const result = await pool.query(
      `DELETE FROM "${request.params.resource}" WHERE "${resource.primaryKey}" = $1 RETURNING "${resource.primaryKey}"`,
      [id],
    );
    if (!result.rowCount) return response.status(404).json({ error: "Registro no encontrado." });
    response.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  if (error.code === "23505") {
    return response.status(409).json({ error: "Ya existe un registro con ese valor único." });
  }
  if (error.code === "23503") {
    return response.status(409).json({ error: "La relación no existe o el registro tiene datos relacionados." });
  }
  if (["23502", "23514", "22P02", "22007", "22003"].includes(error.code)) {
    return response.status(400).json({ error: "Los datos no cumplen el formato o las restricciones de la base." });
  }

  const status = error.status || 500;
  if (status >= 500) console.error(error);
  response.status(status).json({ error: status >= 500 ? "Error interno de la API." : error.message });
});

function validatePayload(body, allowedFields) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const error = new Error("Envía los campos en un objeto JSON.");
    error.status = 400;
    throw error;
  }
  const keys = Object.keys(body);
  if (!keys.length) {
    const error = new Error("Envía al menos un campo para guardar.");
    error.status = 400;
    throw error;
  }
  const unknown = keys.filter((key) => !allowedFields.includes(key));
  if (unknown.length) {
    const error = new Error(`Campos fuera del DER acordado: ${unknown.join(", ")}.`);
    error.status = 400;
    throw error;
  }
  return Object.fromEntries(keys.map((key) => [key, body[key]]));
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    const error = new Error("El identificador debe ser un entero positivo.");
    error.status = 400;
    throw error;
  }
  return id;
}

function extractChatReply(payload) {
  const item = Array.isArray(payload) ? payload[0] : payload;
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return "";
  for (const key of ["output", "text", "response", "reply"]) {
    if (typeof item[key] === "string" && item[key].trim()) return item[key].trim();
  }
  if (typeof item.message === "string") return item.message.trim();
  if (typeof item.message?.content === "string") return item.message.content.trim();
  return "";
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}
