const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: options.body
        ? { "Content-Type": "application/json", ...options.headers }
        : options.headers,
    });
  } catch {
    throw new Error("No se pudo conectar con la API. Comprueba que el backend esté iniciado.");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `La API respondió con estado ${response.status}.`);
  }
  return payload;
}

export const api = {
  health: () => request("/health"),
  chatStatus: () => request("/chat/status"),
  chat: (message, sessionId) =>
    request("/chat", {
      method: "POST",
      body: JSON.stringify({ message, sessionId }),
    }),
  list: (resource) => request(`/${resource}`),
  dashboard: () => request("/dashboard"),
  create: (resource, values) =>
    request(`/${resource}`, { method: "POST", body: JSON.stringify(values) }),
  update: (resource, id, values) =>
    request(`/${resource}/${id}`, { method: "PUT", body: JSON.stringify(values) }),
  remove: (resource, id) => request(`/${resource}/${id}`, { method: "DELETE" }),
};
