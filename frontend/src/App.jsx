import { useEffect, useMemo, useState } from "react";

import { api } from "./api.js";
import { resources } from "./resources.js";

const navigationGroups = [
  { label: "Despacho", keys: ["declaracion", "detalle_declaracion", "contenedor", "inspeccion"] },
  { label: "Almacén", keys: ["inventario", "movimiento_inventario", "bodega"] },
  { label: "Catálogos", keys: ["producto", "categoria_arancelaria", "importador", "pais", "agente_aduanal", "funcionario"] },
];
const resourceDescriptions = {
  pais: "Países de origen vinculados con importadores y declaraciones.",
  importador: "Empresas responsables de la mercancía declarada ante aduanas.",
  agente_aduanal: "Agentes y licencias que tramitan las declaraciones.",
  categoria_arancelaria: "Códigos SA y porcentajes de arancel asociados a los productos.",
  producto: "Mercancías, unidades de medida, valores y clasificación arancelaria.",
  funcionario: "Personal aduanero que participa en las inspecciones.",
  declaracion: "Expedientes con su régimen, origen, importador y estado de despacho.",
  detalle_declaracion: "Productos, cantidades y valores asociados a cada declaración.",
  contenedor: "Unidades de carga vinculadas a las declaraciones aduaneras.",
  bodega: "Ubicaciones y capacidad registrada para el almacenamiento.",
  inventario: "Existencias actuales por producto, bodega, fecha de ingreso y estado.",
  movimiento_inventario: "Entradas, salidas y traslados anotados en bodega.",
  inspeccion: "Resultados, observaciones y funcionarios responsables de la revisión.",
};

function App() {
  const [active, setActive] = useState("dashboard");
  const [records, setRecords] = useState({});
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connection, setConnection] = useState("checking");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [search, setSearch] = useState("");
  const [chatConfigured, setChatConfigured] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      role: "assistant",
      text: "Escribe una consulta sobre declaraciones, productos, importadores o existencias del inventario.",
    },
  ]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatSessionId] = useState(() => globalThis.crypto?.randomUUID?.() || String(Date.now()));

  const activeResource = useMemo(
    () => resources.find((resource) => resource.key === active),
    [active],
  );

  async function reload() {
    setLoading(true);
    setError("");
    const settled = await Promise.allSettled([
      api.health(),
      api.dashboard(),
      ...resources.map((resource) => api.list(resource.key)),
      api.chatStatus(),
    ]);

    const [healthResult, dashboardResult, ...remaining] = settled;
    const resourceResults = remaining.slice(0, resources.length);
    const chatResult = remaining.at(-1);
    setConnection(healthResult.status === "fulfilled" ? "online" : "offline");
    if (dashboardResult.status === "fulfilled") setSummary(dashboardResult.value);
    setRecords((current) => {
      const next = { ...current };
      resourceResults.forEach((result, index) => {
        if (result.status === "fulfilled") next[resources[index].key] = result.value;
      });
      return next;
    });
    if (chatResult?.status === "fulfilled") setChatConfigured(chatResult.value.configured);

    const failed = [healthResult, dashboardResult, ...resourceResults].find(
      (result) => result.status === "rejected",
    );
    if (failed) setError(errorMessage(failed.reason));
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, []);

  function navigate(key) {
    setActive(key);
    closeForm();
    setSearch("");
    setNotice("");
    setError("");
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setFormValues({});
  }

  function openCreate() {
    setEditingId(null);
    setFormValues(Object.fromEntries(
      activeResource.fields.filter((field) => field.default != null).map((field) => [field.key, field.default]),
    ));
    setFormOpen(true);
    setNotice("");
  }

  function openEdit(row) {
    const values = {};
    for (const field of activeResource.fields) {
      const value = row[field.key];
      const stringValue = value == null ? "" : String(value);
      values[field.key] = field.type === "date" ? stringValue.slice(0, 10) : stringValue;
    }
    setEditingId(row[activeResource.primaryKey]);
    setFormValues(values);
    setFormOpen(true);
    setNotice("");
  }

  function toPayload() {
    return Object.fromEntries(
      activeResource.fields.flatMap((field) => {
        const value = formValues[field.key] ?? "";
        if (editingId == null && value === "") return [];
        if (field.type === "number" || field.type === "reference") {
          return [[field.key, value === "" ? null : Number(value)]];
        }
        return [[field.key, value === "" ? null : value.trim()]];
      }),
    );
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (editingId == null) {
        await api.create(activeResource.key, toPayload());
        setNotice(activeResource.singular + " guardado.");
      } else {
        await api.update(activeResource.key, editingId, toPayload());
        setNotice(activeResource.singular + " actualizado.");
      }
      closeForm();
      await reload();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function remove(row) {
    const id = row[activeResource.primaryKey];
    if (!window.confirm("¿Eliminar este registro de " + activeResource.label.toLowerCase() + "?")) return;
    setError("");
    setNotice("");
    try {
      await api.remove(activeResource.key, id);
      setNotice("Registro eliminado.");
      await reload();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  function displayValue(field, value) {
    if (value == null || value === "") return "—";
    if (field.type === "reference") {
      const target = resources.find((resource) => resource.key === field.reference);
      const related = (records[field.reference] || []).find(
        (row) => String(row[target.primaryKey]) === String(value),
      );
      return related?.[field.referenceLabel] ?? "ID " + value;
    }
    if (field.type === "date") return formatDate(value);
    if (field.type === "number") {
      const number = Number(value);
      return Number.isFinite(number)
        ? number.toLocaleString("es-MX", { maximumFractionDigits: 2 })
        : String(value);
    }
    return displayEnum(value);
  }

  function renderControl(field) {
    const value = formValues[field.key] ?? "";
    const onChange = (event) =>
      setFormValues((current) => ({ ...current, [field.key]: event.target.value }));

    if (field.type === "textarea") {
      return <textarea id={field.key} value={value} onChange={onChange} rows="3" />;
    }
    if (field.type === "reference") {
      const target = resources.find((resource) => resource.key === field.reference);
      const options = records[field.reference] || [];
      return (
        <select id={field.key} value={value} onChange={onChange} required={Boolean(field.required)}>
          <option value="">Selecciona una opción</option>
          {options.map((row) => (
            <option key={row[target.primaryKey]} value={row[target.primaryKey]}>
              {row[field.referenceLabel]}
            </option>
          ))}
        </select>
      );
    }
    if (field.type === "select") {
      return (
        <select id={field.key} value={value} onChange={onChange} required={Boolean(field.required)}>
          <option value="">Selecciona una opción</option>
          {field.options.map((option) => <option key={option} value={option}>{displayEnum(option)}</option>)}
        </select>
      );
    }
    return (
      <input
        id={field.key}
        type={field.type}
        step={field.step}
        min={field.min}
        max={field.max}
        value={value}
        onChange={onChange}
        required={Boolean(field.required)}
      />
    );
  }

  async function sendChat(event) {
    event.preventDefault();
    const message = chatDraft.trim();
    if (!message || !chatConfigured || chatSending) return;
    setChatDraft("");
    setChatError("");
    setChatMessages((current) => [...current, { role: "user", text: message }]);
    setChatSending(true);
    try {
      const result = await api.chat(message, chatSessionId);
      setChatMessages((current) => [...current, { role: "assistant", text: result.reply }]);
    } catch (cause) {
      setChatError(errorMessage(cause));
    } finally {
      setChatSending(false);
    }
  }

  const filteredRows = activeResource
    ? (records[activeResource.key] || []).filter((row) => {
        const query = search.trim().toLocaleLowerCase("es-MX");
        if (!query) return true;
        return [row[activeResource.primaryKey], ...activeResource.fields.map((field) => displayValue(field, row[field.key]))]
          .join(" ")
          .toLocaleLowerCase("es-MX")
          .includes(query);
      })
    : [];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Icon name="ship" size={22} /></div>
          <div className="brand-copy"><strong>Inventario Aduanero</strong><small>Lab 3 · Operaciones</small></div>
        </div>

        <div className="sidebar-section-label">ESPACIO DE TRABAJO</div>
        <nav className="primary-nav nav-overview" aria-label="Secciones del sistema">
          <button className={"nav-item" + (active === "dashboard" ? " selected" : "")} onClick={() => navigate("dashboard")}>
            <Icon name="grid" /><span>Vista general</span>
          </button>
        </nav>

        <div className="sidebar-section-label nav-gap">GESTIÓN ADUANERA</div>
        <nav className="primary-nav entity-nav" aria-label="Entidades del inventario">
          {navigationGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.keys.map((key) => {
                const resource = resources.find((item) => item.key === key);
                return resource ? (
                  <button
                    className={"nav-item" + (active === resource.key ? " selected" : "")}
                    key={resource.key}
                    title={resource.label}
                    onClick={() => navigate(resource.key)}
                  >
                    <Icon name={resource.icon || "box"} />
                    <span>{resource.label}</span>
                    <small>{summary?.counts?.[resource.key] ?? "—"}</small>
                  </button>
                ) : null;
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-section-label nav-gap">HERRAMIENTAS</div>
        <button className={"nav-item assistant-link" + (active === "assistant" ? " selected" : "")} onClick={() => navigate("assistant")}>
          <Icon name="message" /><span>Asistente de consultas</span><span className="nav-live" />
        </button>

        <div className="sidebar-bottom">
          <div className={"connection-badge " + connection}>
            <span className="connection-dot" />
            <div><strong>{connection === "online" ? "Base conectada" : connection === "checking" ? "Comprobando conexión" : "API sin conexión"}</strong><small>Supabase · PostgreSQL</small></div>
          </div>
          <div className="sidebar-user"><div className="avatar">L3</div><div><strong>Laboratorio 3</strong><small>13 tablas conectadas</small></div></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>Inventario Aduanero</span><b>/</b><strong>{activeResource?.label || (active === "assistant" ? "Asistente" : "Resumen")}</strong></div>
          <div className="topbar-actions">
            <div className="date-chip"><Icon name="calendar" size={15} />{new Date().toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}</div>
            <button className="icon-button" aria-label="Actualizar datos" title="Actualizar datos" onClick={reload}><Icon name="refresh" size={17} /></button>
            <div className="top-avatar">L3</div>
          </div>
        </header>

        {(error || notice) && (
          <div className={"message-banner " + (error ? "error" : "success")} role="status">
            <Icon name={error ? "alert" : "check"} size={17} />
            <span>{error || notice}</span>
            <button onClick={() => { setError(""); setNotice(""); }} aria-label="Cerrar aviso">×</button>
          </div>
        )}

        {active === "dashboard" ? (
          <Dashboard data={summary} loading={loading} navigate={navigate} connection={connection} />
        ) : active === "assistant" ? (
          <Assistant
            configured={chatConfigured}
            messages={chatMessages}
            draft={chatDraft}
            setDraft={setChatDraft}
            sending={chatSending}
            error={chatError}
            onSubmit={sendChat}
            onSuggestion={setChatDraft}
          />
        ) : activeResource ? (
          <section className="entity-page">
            <div className="entity-heading">
              <div className="heading-icon"><Icon name={activeResource.icon || "box"} size={21} /></div>
              <div className="heading-copy">
                <div className="eyebrow">{navigationGroups.find((group) => group.keys.includes(activeResource.key))?.label.toUpperCase()} <b>/</b> TABLA ACTIVA</div>
                <h1>{activeResource.label}</h1>
                <p>{resourceDescriptions[activeResource.key]}</p>
              </div>
              <button className="primary-button" onClick={openCreate}><Icon name="plus" size={17} />Añadir registro</button>
            </div>

            {formOpen && (
              <form className="form-card" onSubmit={submit}>
                <div className="form-card-heading">
                  <div><div className="eyebrow">{editingId == null ? "ALTA DE " + activeResource.singular.toUpperCase() : "EDICIÓN DE " + activeResource.singular.toUpperCase()}</div><h2>{editingId == null ? "Alta de " + activeResource.singular.toLowerCase() : "Editar " + activeResource.singular.toLowerCase()}</h2></div>
                  <button className="icon-button" type="button" aria-label="Cerrar formulario" onClick={closeForm}><Icon name="close" size={18} /></button>
                </div>
                <div className="form-grid">
                  {activeResource.fields.map((field) => (
                    <label className="field" htmlFor={field.key} key={field.key}>
                      <span>{field.label}</span>{renderControl(field)}
                    </label>
                  ))}
                </div>
                <div className="form-actions">
                  <button className="secondary-button" type="button" onClick={closeForm}>Cancelar</button>
                  <button className="primary-button" type="submit" disabled={saving}>{saving ? "Guardando…" : editingId == null ? "Crear registro" : "Guardar cambios"}</button>
                </div>
              </form>
            )}

            <section className="data-card">
              <div className="data-toolbar">
                <div><h2>Registros</h2><span>{filteredRows.length} de {(records[activeResource.key] || []).length} elementos</span></div>
                <label className="search-box"><Icon name="search" size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={"Buscar en " + activeResource.label.toLowerCase()} /></label>
              </div>
              {loading && !records[activeResource.key] ? (
                <div className="empty-state"><div className="loading-spinner" /><strong>Cargando registros</strong><span>Conectando con el inventario.</span></div>
              ) : filteredRows.length === 0 ? (
                <div className="empty-state"><div className="empty-icon"><Icon name={search ? "search" : "box"} size={22} /></div><strong>{search ? "No encontramos coincidencias" : "Aún no hay registros"}</strong><span>{search ? "Prueba con otro nombre, código o identificador." : "Los datos que agregues aparecerán en esta lista."}</span></div>
              ) : (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th className="id-heading">ID</th>{activeResource.fields.map((field) => <th key={field.key}>{field.label}</th>)}<th className="actions-heading">ACCIONES</th></tr></thead>
                    <tbody>{filteredRows.map((row) => (
                      <tr key={row[activeResource.primaryKey]}>
                        <td className="id-cell">{String(row[activeResource.primaryKey]).padStart(3, "0")}</td>
                        {activeResource.fields.map((field) => (
                          <td key={field.key}>
                            {field.key === "estado"
                              ? <span className={"state-pill " + String(row[field.key]).toLowerCase().replaceAll(" ", "-")}>{displayValue(field, row[field.key])}</span>
                              : displayValue(field, row[field.key])}
                          </td>
                        ))}
                        <td className="actions-cell">
                          <button className="row-action" onClick={() => openEdit(row)} title="Editar registro" aria-label="Editar registro"><Icon name="edit" size={16} /></button>
                          <button className="row-action delete" onClick={() => remove(row)} title="Eliminar registro" aria-label="Eliminar registro"><Icon name="trash" size={16} /></button>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>
            <div className="model-note"><Icon name="lock" size={14} /> Esta pantalla corresponde a una de las trece tablas reales; el DER manual representa las ocho entidades mínimas del entregable.</div>
          </section>
        ) : null}

        {active !== "dashboard" && <footer className="page-footer"><span>Lab 3 · Sistema de inventario aduanero</span><span>DER manual: 8 entidades · Base de trabajo: 13 tablas</span></footer>}
      </main>
    </div>
  );
}

function Dashboard({ data, loading, navigate, connection }) {
  const declarationStates = Object.fromEntries((data?.declaration_states || []).map(({ estado, total }) => [estado, total]));
  const inspectionResults = Object.fromEntries((data?.inspection_results || []).map(({ resultado, total }) => [resultado, total]));
  const declarationTotal = data?.counts?.declaracion || 0;
  const inspectionTotal = data?.counts?.inspeccion || 0;
  const inventoryTotal = Number(data?.total_stock || 0);
  const retainedStock = Number(data?.retained_stock || 0);
  const releasedStock = Number(data?.released_stock || 0);
  const heldPercent = countPercent(retainedStock, inventoryTotal);
  const movementTypes = [
    { key: "entrada", dataKey: "entradas", label: "Entradas" },
    { key: "salida", dataKey: "salidas", label: "Salidas" },
    { key: "traslado", dataKey: "traslados", label: "Traslados" },
  ];
  const monthlyMap = new Map();
  (data?.monthly_movements || []).forEach((row) => {
    if (!monthlyMap.has(row.periodo)) {
      monthlyMap.set(row.periodo, { periodo: row.periodo, entradas: 0, salidas: 0, traslados: 0, cantidad: 0, movimientos: 0 });
    }
    const month = monthlyMap.get(row.periodo);
    const key = slugify(row.tipo) + "s";
    if (Object.hasOwn(month, key)) month[key] += Number(row.cantidad || 0);
    month.cantidad += Number(row.cantidad || 0);
    month.movimientos += Number(row.movimientos || 0);
  });
  const monthlySeries = [...monthlyMap.values()];
  const chartMaximum = Math.max(1, ...monthlySeries.map((month) => month.cantidad));
  const declarationRows = data?.recent_declarations || [];
  const inspectionRows = [
    { label: "Aprobadas", value: inspectionResults.Aprobada || 0, slug: "approved" },
    { label: "Con observaciones", value: inspectionResults["Con observaciones"] || 0, slug: "observations" },
    { label: "Rechazadas", value: inspectionResults.Rechazada || 0, slug: "rejected" },
  ];
  const declarationRowsByState = [
    { label: "Retenidas", value: declarationStates.Retenida || 0, slug: "retenida" },
    { label: "En inspección", value: declarationStates["En inspeccion"] || 0, slug: "en-inspeccion" },
    { label: "Liberadas", value: declarationStates.Liberada || 0, slug: "liberada" },
  ];
  const kpis = [
    { key: "declaracion", label: "Declaraciones", value: declarationTotal, detail: `${formatNumber(declarationStates.Retenida || 0)} retenidas · ${formatNumber(declarationStates["En inspeccion"] || 0)} en inspección`, icon: "document", tint: "blue" },
    { key: "inventario", label: "Existencias", value: inventoryTotal, unit: "unid.", detail: `${formatNumber(retainedStock)} retenidas · ${formatNumber(releasedStock)} liberadas`, icon: "box", tint: "amber" },
    { key: "contenedor", label: "Contenedores", value: data?.counts?.contenedor, detail: `${formatNumber(data?.counts?.bodega)} bodegas registradas`, icon: "layers", tint: "teal" },
    { key: "inspeccion", label: "Inspecciones", value: inspectionTotal, detail: `${formatNumber(inspectionResults.Rechazada || 0)} rechazadas · ${formatNumber(inspectionResults.Aprobada || 0)} aprobadas`, icon: "compass", tint: "violet" },
  ];

  return (
    <section className="dashboard-page">
      <header className="control-header">
        <div className="control-title">
          <div className="eyebrow"><span className="control-mark" />SISTEMA ADUANERO <b>/</b> LAB 3</div>
          <h1>Panel de operaciones</h1>
          <p>Declaraciones, inventario e inspecciones en un mismo tablero.</p>
        </div>
        <div className="control-readout">
          <span className="readout-label">BASE DE DATOS</span>
          <strong className={"readout-value " + connection}>{connection === "online" ? "CONECTADA" : connection === "checking" ? "CONECTANDO" : "SIN CONEXIÓN"}</strong>
          <span className="readout-source"><i className={"overview-status " + connection} /> Supabase · PostgreSQL</span>
        </div>
        <div className="container-lines" aria-hidden="true" />
      </header>

      <div className="kpi-grid">
        {kpis.map((item, index) => (
          <button className={`kpi-card kpi-${item.tint}`} key={item.key} onClick={() => navigate(item.key)}>
            <div className="kpi-label"><span className="kpi-icon"><Icon name={item.icon} size={18} /></span><span>{item.label}</span><Icon name="arrow-up-right" size={14} /></div>
            <strong className="kpi-value">{loading ? "—" : formatNumber(item.value)}{item.unit && <small>{item.unit}</small>}</strong>
            <span className="kpi-detail">{loading ? "Cargando datos…" : item.detail}</span>
            <span className="kpi-index">0{index + 1}</span>
          </button>
        ))}
      </div>

      <div className="analytics-grid">
        <section className="analytics-card movement-chart-card">
          <div className="panel-title-row">
            <div><div className="eyebrow">ACTIVIDAD DE BODEGA</div><h2>Mercancía por movimiento</h2><p>Cantidad registrada por mes y tipo de movimiento.</p></div>
            <button className="icon-button chart-link" onClick={() => navigate("movimiento_inventario")} title="Abrir movimientos" aria-label="Abrir movimientos"><Icon name="arrow-up-right" size={16} /></button>
          </div>
          <div className="bar-chart" role="img" aria-label="Cantidad mensual de mercancía por tipo de movimiento">
            <div className="chart-axis"><span>{formatNumber(chartMaximum)}</span><span>{formatNumber(Math.round(chartMaximum / 2))}</span><span>0</span></div>
            <div className="chart-plot">
              <div className="chart-guides"><i /><i /><i /></div>
              {monthlySeries.length ? monthlySeries.map((month) => (
                <div className="chart-month" key={month.periodo} title={`${formatMonth(month.periodo)} · ${formatNumber(month.cantidad)} unidades · ${month.movimientos} movimientos`}>
                  <div className="chart-bars">
                    {movementTypes.map((type) => (
                      <i className={`chart-bar ${type.key}`} key={type.key} style={{ height: `${Math.max(0, Number(month[type.dataKey] || 0) / chartMaximum * 100)}%` }} />
                    ))}
                  </div>
                  <span>{formatMonth(month.periodo)}</span>
                </div>
              )) : <div className="chart-empty">No hay movimientos fechados para graficar.</div>}
            </div>
          </div>
          <div className="chart-legend">{movementTypes.map((type) => <span key={type.key}><i className={type.key} />{type.label}</span>)}</div>
        </section>

        <section className="analytics-card stock-chart-card">
          <div className="panel-title-row">
            <div><div className="eyebrow">ESTADO DE INVENTARIO</div><h2>Existencias por condición</h2><p>Distribución de cantidades almacenadas.</p></div>
            <button className="icon-button chart-link" onClick={() => navigate("inventario")} title="Abrir inventario" aria-label="Abrir inventario"><Icon name="arrow-up-right" size={16} /></button>
          </div>
          <div className="stock-chart-content">
            <div className="stock-donut" style={{ background: `conic-gradient(#d58a4e 0 ${heldPercent}%, #55a18a ${heldPercent}% 100%)` }} role="img" aria-label={`${formatNumber(retainedStock)} unidades retenidas y ${formatNumber(releasedStock)} liberadas`}>
              <div><strong>{loading ? "—" : formatNumber(inventoryTotal)}</strong><span>UNIDADES</span></div>
            </div>
            <div className="stock-chart-legend">
              <div><span><i className="held-dot" />Retenidas</span><strong>{loading ? "—" : formatNumber(retainedStock)}</strong><small>{loading ? "—" : formatPercent(heldPercent)} del total</small></div>
              <div><span><i className="released-dot" />Liberadas</span><strong>{loading ? "—" : formatNumber(releasedStock)}</strong><small>{loading ? "—" : formatPercent(100 - heldPercent)} del total</small></div>
            </div>
          </div>
          <div className="stock-chart-foot"><Icon name="warehouse" size={15} /> {loading ? "Calculando inventario…" : `Total agregado de ${formatNumber(data?.counts?.inventario)} registros de inventario`}</div>
        </section>
      </div>

      <div className="records-grid">
        <section className="analytics-card declarations-card">
          <div className="panel-title-row">
            <div><div className="eyebrow">CONTROL DOCUMENTAL</div><h2>Declaraciones recientes</h2><p>Expedientes ordenados por fecha de registro.</p></div>
            <button className="text-button" onClick={() => navigate("declaracion")}>Ver todas <Icon name="arrow-up-right" size={14} /></button>
          </div>
          {loading ? <div className="table-loading">Consultando declaraciones…</div> : declarationRows.length ? (
            <div className="table-scroll dashboard-table-scroll">
              <table className="data-table dashboard-table">
                <thead><tr><th>DECLARACIÓN</th><th>IMPORTADOR</th><th>PAÍS DE ORIGEN</th><th>RÉGIMEN</th><th>ESTADO</th><th>FECHA</th></tr></thead>
                <tbody>{declarationRows.map((row) => (
                  <tr key={row.id_declaracion}>
                    <td className="declaration-number">{row.numero}</td>
                    <td>{row.importador || "—"}</td>
                    <td>{row.pais_origen || "—"}</td>
                    <td>{displayEnum(row.regimen)}</td>
                    <td><span className={`state-pill ${slugify(row.estado)}`}>{displayEnum(row.estado)}</span></td>
                    <td>{formatDate(row.fecha)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className="empty-inline">No hay declaraciones registradas.</div>}
        </section>

        <aside className="status-stack">
          <section className="analytics-card status-card">
            <div className="panel-title-row"><div><div className="eyebrow">DESPACHO</div><h2>Estado de declaraciones</h2></div><span className="mini-total">{loading ? "—" : formatNumber(declarationTotal)}</span></div>
            <div className="status-list">{declarationRowsByState.map((row) => (
              <div className="status-row" key={row.slug}>
                <div><span className={`status-marker ${row.slug}`} />{row.label}<strong>{loading ? "—" : formatNumber(row.value)}</strong></div>
                <i><span className={row.slug} style={{ width: loading ? "0%" : `${countPercent(row.value, declarationTotal)}%` }} /></i>
              </div>
            ))}</div>
          </section>
          <section className="analytics-card inspection-summary-card">
            <div className="panel-title-row"><div><div className="eyebrow">REVISIÓN FÍSICA</div><h2>Inspecciones</h2></div><span className="mini-total">{loading ? "—" : formatNumber(inspectionTotal)}</span></div>
            <div className="inspection-stack" aria-label="Distribución de resultados de inspecciones">
              {inspectionRows.map((row) => <i className={"inspection-segment " + row.slug} key={row.slug} style={{ width: loading ? "0%" : countPercent(row.value, inspectionTotal) + "%" }} />)}
            </div>
            <div className="inspection-compact">{inspectionRows.map((row) => <span key={row.slug}><i className={row.slug} />{row.label}<b>{loading ? "—" : formatNumber(row.value)}</b></span>)}</div>
          </section>
        </aside>
      </div>

      <section className="analytics-card movements-panel">
        <div className="panel-title-row">
          <div><div className="eyebrow">BITÁCORA DE BODEGA</div><h2>Movimientos recientes</h2><p>Entradas, salidas y traslados registrados.</p></div>
          <button className="text-button" onClick={() => navigate("movimiento_inventario")}>Ver movimientos <Icon name="arrow-up-right" size={14} /></button>
        </div>
        {loading ? <div className="table-loading">Consultando movimientos…</div> : data?.recent_movements?.length ? (
          <div className="movement-list">
            {data.recent_movements.map((movement) => (
              <div className="movement-row" key={movement.id_movimiento}>
                <span className="movement-id">MOV-{String(movement.id_movimiento).padStart(3, "0")}</span>
                <span className={"movement-type " + slugify(movement.tipo)}>{displayEnum(movement.tipo)}</span>
                <div className="movement-description"><strong>{movement.producto || "Producto sin referencia"}</strong><span>{movement.bodega || "Bodega sin referencia"}</span></div>
                <time>{formatDate(movement.fecha)}</time>
                <strong className="movement-quantity">{formatNumber(movement.cantidad)} <small>unid.</small></strong>
              </div>
            ))}
          </div>
        ) : <div className="empty-inline">No hay movimientos registrados.</div>}
      </section>

      <footer className="dashboard-footer">
        <span><i className={"overview-status " + connection} />{connection === "online" ? "Datos sincronizados con Supabase" : "No se pudo confirmar la conexión"}</span>
        <span>DER manual <b>8 entidades</b><i />Base de datos <b>13 tablas</b></span>
      </footer>
    </section>
  );
}

function Assistant({ configured, messages, draft, setDraft, sending, error, onSubmit, onSuggestion }) {
  const suggestions = [
    "¿Cuántas unidades están retenidas?",
    "Muéstrame las declaraciones recientes",
    "¿Qué productos hay en inventario?",
  ];

  return (
    <section className="assistant-page">
      <div className="assistant-page-heading">
        <div><div className="eyebrow">LAB 3 / INVENTARIO ADUANERO</div><h1>Asistente de consultas</h1><p>Pregunta por declaraciones, productos, importadores, inventario o bodegas.</p></div>
        <div className={"assistant-status " + (configured ? "ready" : "pending")}><span className="connection-dot" />{configured ? "Conectado a n8n" : "n8n sin enlazar"}</div>
      </div>

      {!configured && <div className="setup-banner"><div className="setup-icon"><Icon name="plug" size={19} /></div><div><strong>El chat está listo para enlazarse al workflow.</strong><p>Falta copiar la URL de producción del nodo Chat Trigger al campo <code>N8N_CHAT_WEBHOOK_URL</code> de <code>backend/.env</code>. La guía está en <code>n8n/README.md</code>.</p></div></div>}

      <div className="chat-layout">
        <section className="chat-card">
          <div className="chat-header"><div className="chat-agent-mark"><Icon name="message" size={19} /></div><div><strong>Consultas del inventario</strong><span><i className={configured ? "online-dot" : "offline-dot"} />{configured ? "Disponible para consultas" : "Conexión pendiente"}</span></div><button type="button" className="icon-button" title="Nueva conversación" aria-label="Nueva conversación" onClick={() => window.location.reload()}><Icon name="refresh" size={16} /></button></div>
          <div className="chat-transcript" aria-live="polite">
            {messages.map((message, index) => (
              <div className={"chat-message " + message.role} key={index}>
                {message.role === "assistant" && <div className="message-avatar"><Icon name="message" size={13} /></div>}
                <div className="message-bubble">
                  {message.role === "assistant" ? <AssistantMessage text={message.text} /> : message.text}
                </div>
              </div>
            ))}
            {sending && <div className="chat-message assistant"><div className="message-avatar"><Icon name="message" size={13} /></div><div className="message-bubble typing"><i /><i /><i /></div></div>}
            {error && <div className="chat-error"><Icon name="alert" size={15} />{error}</div>}
          </div>
          <form className="chat-composer" onSubmit={onSubmit}>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={configured ? "Escribe tu consulta…" : "Configura el workflow para comenzar"} disabled={!configured || sending} aria-label="Mensaje para el asistente" />
            <button type="submit" className="send-button" disabled={!configured || sending || !draft.trim()} aria-label="Enviar mensaje"><Icon name="arrow-up" size={18} /></button>
          </form>
          <div className="chat-footnote"><Icon name="lock" size={13} /> El asistente debe consultar datos con acceso de solo lectura.</div>
        </section>

        <aside className="assistant-guide">
          <div className="eyebrow">IDEAS PARA EMPEZAR</div><h2>Consultas que puedes hacer</h2>
          <div className="suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => onSuggestion(suggestion)} disabled={!configured}><span><Icon name="message" size={15} /></span>{suggestion}<Icon name="arrow-up-right" size={14} /></button>)}</div>
          <div className="guide-divider" />
          <div className="guide-note"><Icon name="lock" size={18} /><div><strong>Alcance de datos</strong><p>El agente consulta las trece tablas reales con permisos de solo lectura. El DER manual representa ocho entidades.</p></div></div>
        </aside>
      </div>
    </section>
  );
}

function AssistantMessage({ text }) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.includes("|")) {
      const tableLines = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      const rows = tableLines
        .filter((row) => !isMarkdownTableDivider(row))
        .map(splitMarkdownTableRow);
      const [headers, ...body] = rows;

      if (headers?.length) {
        blocks.push(
          <div className="message-table-wrap" key={`table-${blocks.length}`}>
            <table className="message-table">
              <thead><tr>{headers.map((cell, cellIndex) => <th key={cellIndex}>{renderInlineMarkdown(cell)}</th>)}</tr></thead>
              <tbody>
                {body.map((row, rowIndex) => (
                  <tr key={rowIndex}>{headers.map((_, cellIndex) => <td key={cellIndex}>{renderInlineMarkdown(row[cellIndex] || "")}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }

    const listItem = parseMarkdownListItem(line);
    if (listItem) {
      const listItems = [];
      const ordered = listItem.ordered;
      while (index < lines.length) {
        const nextItem = parseMarkdownListItem(lines[index]);
        if (!nextItem || nextItem.ordered !== ordered) break;
        listItems.push(nextItem.text);
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List className="message-list" key={`list-${blocks.length}`}>{listItems.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}</List>);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !lines[index].includes("|") && !parseMarkdownListItem(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={`paragraph-${blocks.length}`}>{renderInlineMarkdown(paragraph.join(" "))}</p>);
  }

  return <div className="message-content">{blocks}</div>;
}

function renderInlineMarkdown(text) {
  return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function splitMarkdownTableRow(row) {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isMarkdownTableDivider(row) {
  const cells = splitMarkdownTableRow(row);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseMarkdownListItem(line) {
  const match = line.trim().match(/^(?:(\d+)[.)]\s+|[-*]\s+)(.+)$/);
  if (!match) return null;
  return { ordered: Boolean(match[1]), text: match[2] };
}

function Icon({ name, size = 18 }) {
  const paths = {
    ship: <><path d="M3 17h18l-2.2 4H6z" /><path d="M6 17V9h12v8M9 9V5h6v4M3 13h18M10 13h4" /></>,
    grid: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></>,
    box: <><path d="m12 3 9 5-9 5-9-5z" /><path d="M3 8v9l9 5 9-5V8M12 13v9" /></>,
    document: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5" /></>,
    warehouse: <><path d="m3 10 9-7 9 7v11H3z" /><path d="M7 21v-8h10v8M7 9h.01M12 9h.01M17 9h.01" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9a7 7 0 0 1 12-2L20 12M4 12l2.5 5a7 7 0 0 0 12-2" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    edit: <><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5z" /><path d="m13.5 7 3.5 3.5" /></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    alert: <><path d="M12 3 2.7 20h18.6z" /><path d="M12 9v5M12 17h.01" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    "arrow-up-right": <><path d="M7 17 17 7M7 7h10v10" /></>,
    "arrow-right": <><path d="M4 12h16M13 5l7 7-7 7" /></>,
    "arrow-up": <><path d="M12 19V5M5 12l7-7 7 7" /></>,
    compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V6z" /><path d="m9 12 2 2 4-4" /></>,
    plug: <><path d="M8 7v5M16 7v5M7 12h10v2a5 5 0 0 1-10 0zM12 19v3M5 5l3 2M19 5l-3 2" /></>,
    message: <><path d="M4 5h16v12H9l-5 4z" /><path d="M8 9h8M8 13h5" /></>,
  };

  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.box}</svg>;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("es-MX", { maximumFractionDigits: 2 });
}

const enumLabels = {
  Importacion: "Importación",
  Exportacion: "Exportación",
  Transito: "Tránsito",
  Deposito: "Depósito",
  "En inspeccion": "En inspección",
};

function displayEnum(value) {
  if (value == null || value === "") return "—";
  return enumLabels[value] || String(value);
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString("es-MX", { maximumFractionDigits: 1 })}%`;
}

function formatMonth(value) {
  if (!value) return "—";
  const date = new Date(`${value}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  const month = date.toLocaleDateString("es-MX", { month: "short", timeZone: "UTC" }).replace(".", "");
  return `${month} ${value.slice(2, 4)}`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function countPercent(value, total) {
  if (!Number(total)) return 0;
  return Math.max(0, Math.min(100, (Number(value || 0) / Number(total)) * 100));
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "Ocurrió un error al procesar la solicitud.";
}

export default App;
