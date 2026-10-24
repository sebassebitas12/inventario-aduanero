export const resources = {
  pais: {
    label: "Países",
    singular: "País",
    primaryKey: "id_pais",
    fields: ["nombre", "codigo_iso"],
  },
  importador: {
    label: "Importadores",
    singular: "Importador",
    primaryKey: "id_importador",
    fields: ["razon_social", "identificacion", "direccion", "telefono", "correo", "id_pais"],
  },
  agente_aduanal: {
    label: "Agentes aduanales",
    singular: "Agente aduanal",
    primaryKey: "id_agente",
    fields: ["nombre", "licencia", "telefono"],
  },
  categoria_arancelaria: {
    label: "Categorías arancelarias",
    singular: "Categoría arancelaria",
    primaryKey: "id_categoria",
    fields: ["codigo_sa", "descripcion", "porcentaje_arancel"],
  },
  producto: {
    label: "Productos",
    singular: "Producto",
    primaryKey: "id_producto",
    fields: ["descripcion", "unidad_medida", "valor_unitario", "id_categoria"],
  },
  funcionario: {
    label: "Funcionarios",
    singular: "Funcionario",
    primaryKey: "id_funcionario",
    fields: ["nombre", "cargo", "id_supervisor"],
  },
  declaracion: {
    label: "Declaraciones",
    singular: "Declaración",
    primaryKey: "id_declaracion",
    fields: [
      "numero",
      "fecha",
      "regimen",
      "estado",
      "id_importador",
      "id_agente",
      "id_pais_origen",
    ],
  },
  detalle_declaracion: {
    label: "Detalles de declaración",
    singular: "Detalle de declaración",
    primaryKey: "id_detalle",
    fields: ["id_declaracion", "id_producto", "cantidad", "valor_declarado"],
  },
  contenedor: {
    label: "Contenedores",
    singular: "Contenedor",
    primaryKey: "id_contenedor",
    fields: ["numero", "tipo", "peso_kg", "id_declaracion"],
  },
  bodega: {
    label: "Bodegas",
    singular: "Bodega",
    primaryKey: "id_bodega",
    fields: ["nombre", "ubicacion", "capacidad"],
  },
  inventario: {
    label: "Inventario",
    singular: "Registro de inventario",
    primaryKey: "id_inventario",
    fields: ["id_bodega", "id_producto", "cantidad", "fecha_ingreso", "estado"],
  },
  movimiento_inventario: {
    label: "Movimientos de inventario",
    singular: "Movimiento de inventario",
    primaryKey: "id_movimiento",
    fields: ["tipo", "fecha", "cantidad", "id_producto", "id_bodega"],
  },
  inspeccion: {
    label: "Inspecciones",
    singular: "Inspección",
    primaryKey: "id_inspeccion",
    fields: ["fecha", "resultado", "observaciones", "id_declaracion", "id_funcionario"],
  },
};

export function getResource(name) {
  if (!Object.hasOwn(resources, name)) {
    const error = new Error("Entidad no reconocida.");
    error.status = 404;
    throw error;
  }
  return resources[name];
}
