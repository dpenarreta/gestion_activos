import {
  activosEnLaWeb,
  alertasDelPanel,
  cambiosDelMovimiento,
  codigoLeido,
  confirmacionDeSalida,
  cuerpoDeAsignacion,
  cuantosActivos,
  dinero,
  estadoDelActivo,
  estadosParaCambiar,
  estaOperativo,
  fichaEnLaWeb,
  filtroDelInventario,
  garantiaDe,
  hayCambioDeAsignacion,
  kpisDelPanel,
  mantenimientosOrdenados,
  mensajeDeActivos,
  nombreDeFila,
  parametrosDelInventario,
  resumenDeAsignacion,
  TEXTO_MODULO_APAGADO,
  TEXTO_MOTIVO_OBLIGATORIO,
  TEXTO_PUEDE_HABERSE_GUARDADO,
  TEXTO_SIN_PERMISO,
  textoDeAlerta,
  tieneAccesoAActivos,
  transicionesDeSolicitud,
  validarCambioDeEstado,
  valoresDeAsignacion,
  puedePedirEquipos,
  veLasRecibidas,
  veMisSolicitudes,
} from "../src/activos/formato";
import { funcionalidadesVisibles, moduloPorId, modulosVisibles, vistaActiva } from "../src/navegacion/modulos";
import { MODULOS_EN_APP, rutaDeActivos, rutaDeSolicitudes, rutaEnApp } from "../src/notificaciones/modulosEnApp";

function error(status, data) {
  const e = new Error("x");
  e.response = { status, data };
  return e;
}

/** El `contexto` del catálogo con solo estos permisos. */
function contexto(permisos = []) {
  return { permisos, licencias: {}, chat: {}, soporte: {}, vistas: {} };
}

const ids = (lista) => lista.map((x) => x.id);

describe("el módulo en la navegación (US-022, CA-1)", () => {
  it("con activos.ver: Panel · Inventario · Escanear, a la derecha de la Matriz", () => {
    const visibles = modulosVisibles(contexto(["activos.ver"]));
    expect(ids(visibles).at(-1)).toBe("activos");
    expect(ids(funcionalidadesVisibles(moduloPorId("activos"), contexto(["activos.ver"])))).toEqual([
      "panel",
      "inventario",
      "escanear",
    ]);
    expect(moduloPorId("activos").texto).toBe("Gestión de Activos");
  });

  it("cada funcionalidad con su permiso; todas juntas en el orden de la historia", () => {
    const todo = contexto(["activos.ver", "mantenimientos.ver", "solicitudes.ver", "solicitudes.gestionar"]);
    expect(ids(funcionalidadesVisibles(moduloPorId("activos"), todo))).toEqual([
      "panel",
      "inventario",
      "escanear",
      "mantenimientos",
      "mis_solicitudes",
      "recibidas",
    ]);
    expect(ids(funcionalidadesVisibles(moduloPorId("activos"), contexto(["solicitudes.ver"])))).toEqual(["mis_solicitudes"]);
    expect(ids(funcionalidadesVisibles(moduloPorId("activos"), contexto(["solicitudes.ver", "solicitudes.administrar"])))).toEqual([
      "mis_solicitudes",
      "recibidas",
    ]);
    expect(ids(funcionalidadesVisibles(moduloPorId("activos"), contexto(["mantenimientos.ver"])))).toEqual(["mantenimientos"]);
  });

  it("sin ningún permiso del módulo, la pestaña no aparece", () => {
    expect(ids(modulosVisibles(contexto([])))).not.toContain("activos");
    expect(ids(modulosVisibles(contexto(["activos.ver_asignados", "soporte.crear"])))).not.toContain("activos");
    expect(tieneAccesoAActivos([])).toBe(false);
    expect(tieneAccesoAActivos(["solicitudes.ver"])).toBe(true);
  });

  // QA-FUNC B1 (CA-1 corregido el 16/11/2026): el servidor exige
  // `solicitudes.ver` para toda lectura.
  it("Dado que solo tengo `solicitudes.crear`, Cuando abro la app, Entonces no veo «Mis solicitudes» ni la pestaña", () => {
    const c = contexto(["solicitudes.crear"]);
    expect(veMisSolicitudes(["solicitudes.crear"])).toBe(false);
    expect(ids(funcionalidadesVisibles(moduloPorId("activos"), c))).toEqual([]);
    expect(ids(modulosVisibles(c))).not.toContain("activos");
  });

  it("Dado que tengo `solicitudes.ver` y `solicitudes.crear`, Entonces veo «Mis solicitudes» y puedo pedir; sin `crear`, no pido", () => {
    expect(veMisSolicitudes(["solicitudes.ver", "solicitudes.crear"])).toBe(true);
    expect(puedePedirEquipos(["solicitudes.ver", "solicitudes.crear"])).toBe(true);
    expect(puedePedirEquipos(["solicitudes.ver"])).toBe(false);
  });

  it("Dado que gestiono o administro sin `solicitudes.ver`, Entonces no veo «Recibidas»; con `ver`, sí", () => {
    expect(veLasRecibidas(["solicitudes.gestionar"])).toBe(false);
    expect(veLasRecibidas(["solicitudes.administrar"])).toBe(false);
    expect(ids(funcionalidadesVisibles(moduloPorId("activos"), contexto(["solicitudes.gestionar"])))).toEqual([]);
    expect(veLasRecibidas(["solicitudes.ver", "solicitudes.gestionar"])).toBe(true);
    expect(veLasRecibidas(["solicitudes.ver", "solicitudes.administrar"])).toBe(true);
  });

  it("«Escanear» es una acción de la pila; las demás, vistas de `/activos?vista=`", () => {
    const modulo = moduloPorId("activos");
    expect(modulo.funcionalidades.find((f) => f.id === "escanear")).toMatchObject({ tipo: "accion", ruta: "/activos/escanear" });
    expect(modulo.pathnames).toEqual(["/activos"]);
  });

  it("la vista por defecto es el Panel; sin activos.ver, la primera que se ve", () => {
    const modulo = moduloPorId("activos");
    expect(vistaActiva(modulo, { name: "activos", params: {} }, contexto(["activos.ver"]))).toBe("panel");
    expect(vistaActiva(modulo, { name: "activos", params: { vista: "inventario" } }, contexto(["activos.ver"]))).toBe("inventario");
    expect(vistaActiva(modulo, { name: "activos", params: {} }, contexto(["solicitudes.ver"]))).toBe("mis_solicitudes");
    // Una vista sin permiso no se abre por la ruta.
    expect(vistaActiva(modulo, { name: "activos", params: { vista: "recibidas" } }, contexto(["activos.ver"]))).toBe("panel");
  });
});

describe("estados del activo", () => {
  it("cada estado con su texto, su ícono y su grupo (no solo color)", () => {
    expect(estadoDelActivo("en_uso")).toMatchObject({ texto: "Asignado", grupo: "parque" });
    expect(estadoDelActivo("disponible")).toMatchObject({ texto: "Disponible", grupo: "almacen" });
    expect(estadoDelActivo("en_bodega").grupo).toBe("almacen");
    expect(estadoDelActivo("robado")).toMatchObject({ texto: "Robado", grupo: "fuera" });
    expect(estadoDelActivo("en_mantenimiento").icono).toBeTruthy();
    expect(estadoDelActivo("nuevo_raro", "Otro")).toMatchObject({ texto: "Otro", icono: "label-outline" });
  });

  it("estados para cambiar: todos menos el actual; desde «Dado de baja», ninguno", () => {
    const opciones = estadosParaCambiar("en_uso");
    expect(opciones).toHaveLength(8);
    expect(opciones.map((o) => o.valor)).not.toContain("en_uso");
    expect(opciones.filter((o) => o.salida).map((o) => o.valor)).toEqual(["dado_de_baja", "perdido", "robado"]);
    expect(estadosParaCambiar("dado_de_baja")).toEqual([]);
  });

  it("CA-9: el motivo es obligatorio para sacarlo del inventario", () => {
    expect(validarCambioDeEstado({ estado: "", motivo: "" })).toHaveProperty("estado");
    expect(validarCambioDeEstado({ estado: "perdido", motivo: "  " })).toEqual({ motivo: TEXTO_MOTIVO_OBLIGATORIO });
    expect(validarCambioDeEstado({ estado: "perdido", motivo: "Se extravió en el andén" })).toEqual({});
    expect(validarCambioDeEstado({ estado: "en_bodega", motivo: "" })).toEqual({});
    const pregunta = confirmacionDeSalida("robado", { codigo_barras: "GA-LAP-000042", nombre: "Laptop Dell" });
    expect(pregunta.titulo).toBe("¿Marcar como «Robado»?");
    expect(pregunta.mensaje).toMatch(/^GA-LAP-000042 · Laptop Dell\. .*denuncia/);
  });

  it("operativo según el servidor o, si no lo dice, según el estado", () => {
    expect(estaOperativo({ esta_operativo: false, estado: "en_uso" })).toBe(false);
    expect(estaOperativo({ estado: "perdido" })).toBe(false);
    expect(estaOperativo({ estado: "en_bodega" })).toBe(true);
  });
});

describe("inventario (CA-6)", () => {
  it("los chips con los parámetros de la API", () => {
    expect(parametrosDelInventario({ filtro: "todos" })).toEqual({ page: 1 });
    expect(parametrosDelInventario({ filtro: "asignados", q: " dell ", pagina: 2 })).toEqual({
      estado: "en_uso",
      q: "dell",
      page: 2,
    });
    expect(parametrosDelInventario({ filtro: "almacen" })).toMatchObject({ almacenados: "true" });
    expect(parametrosDelInventario({ filtro: "reparacion" })).toMatchObject({ estado: "en_mantenimiento" });
    expect(parametrosDelInventario({ filtro: "fuera" })).toMatchObject({ operativos: "false" });
    expect(filtroDelInventario("no-existe").clave).toBe("todos");
  });

  it("la fila se dice entera", () => {
    expect(
      nombreDeFila({
        codigo_barras: "GA-LAP-000042",
        nombre: "Laptop",
        tipo_nombre: "Laptop",
        estado: "en_uso",
        responsables_resumen: "Ana Pérez",
        departamento_nombre: "Cartera",
        sede_nombre: "Matriz Quito",
      }),
    ).toBe("GA-LAP-000042. Laptop. Laptop. Estado: Asignado. Responsable: Ana Pérez. Lugar: Cartera · Matriz Quito");
    expect(nombreDeFila({ codigo_barras: "X", nombre: "Y", estado: "en_bodega" })).toMatch(/Responsable: sin asignar/);
    expect(cuantosActivos(1)).toBe("1 activo");
    expect(cuantosActivos(3)).toBe("3 activos");
  });
});

const PANEL = {
  activos: {
    total: 120,
    en_uso: 80,
    disponibles: 10,
    en_bodega: 5,
    en_mantenimiento: 3,
    perdidos: 1,
    robados: 1,
    reemplazo_recomendado: 0,
    sin_asignar_mas_de_90_dias: 4,
  },
  garantias: { vencidas: 7, por_vencer: 0, dias_de_aviso: 30 },
};

describe("panel (CA-3, CA-4)", () => {
  it("cuatro tarjetas; «En almacén» es disponibles + en bodega; cada una con su filtro", () => {
    const kpis = kpisDelPanel(PANEL);
    expect(kpis.map((k) => [k.titulo, k.cifra, k.filtro])).toEqual([
      ["Registrados", 120, "todos"],
      ["Asignados", 80, "asignados"],
      ["En almacén", 15, "almacen"],
      ["En reparación", 3, "reparacion"],
    ]);
    expect(kpisDelPanel({}).map((k) => k.cifra)).toEqual([0, 0, 0, 0]);
  });

  it("solo las alertas con algo, con su número y su texto", () => {
    const alertas = alertasDelPanel(PANEL);
    expect(alertas.map((a) => [a.clave, a.cifra])).toEqual([
      ["garantias_vencidas", 7],
      ["perdidos", 2],
      ["sin_asignar", 4],
    ]);
    expect(textoDeAlerta(alertas[0])).toBe("Garantía vencida: 7 equipos");
    expect(textoDeAlerta(alertas[1])).toBe("Perdidos o robados: 2 equipos");
    expect(textoDeAlerta({ cifra: 1, texto: "Reemplazo recomendado" })).toBe("Reemplazo recomendado: 1 equipo");
    expect(alertasDelPanel({})).toEqual([]);
  });

  it("los montos como la web (es-EC, USD), también si llegan como texto", () => {
    expect(dinero("1234.5")).toBe("$1.234,50");
    expect(dinero(0)).toBe("$0,00");
    expect(dinero("1000000")).toBe("$1.000.000,00");
    expect(dinero(-12.3)).toBe("-$12,30");
    expect(dinero(null)).toBe("—");
    expect(dinero("abc")).toBe("abc");
  });
});

describe("ficha (CA-7)", () => {
  it("los mantenimientos abiertos primero y luego del más reciente", () => {
    const orden = mantenimientosOrdenados([
      { id: 1, fecha_intervencion: "2026-10-01", fecha_salida: "2026-10-03" },
      { id: 2, fecha_intervencion: "2026-09-01", fecha_salida: null },
      { id: 3, fecha_intervencion: "2026-11-01", fecha_salida: "2026-11-02" },
    ]);
    expect(orden.map((m) => m.id)).toEqual([2, 3, 1]);
    expect(mantenimientosOrdenados(null)).toEqual([]);
  });

  it("la garantía con su texto y lo que falta o pasó", () => {
    expect(garantiaDe({ estado_garantia: "por_vencer", dias_para_fin_de_garantia: 12 })).toMatchObject({
      texto: "Garantía por vencer",
      detalle: "Quedan 12 días",
    });
    expect(garantiaDe({ estado_garantia: "vencida", dias_para_fin_de_garantia: -1 }).detalle).toBe("Venció hace 1 día");
    expect(garantiaDe({}).texto).toBe("Sin garantía registrada");
  });

  it("un movimiento dice solo lo que cambió", () => {
    expect(
      cambiosDelMovimiento({
        custodio_anterior_nombre: null,
        custodio_nuevo_nombre: "Ana Pérez",
        departamento_anterior_nombre: "Cartera",
        departamento_nuevo_nombre: "Cartera",
        estado_anterior: "en_bodega",
        estado_nuevo: "en_uso",
      }),
    ).toEqual(["Responsable: ninguno → Ana Pérez", "Estado: En bodega → Asignado"]);
  });

  it("lo de la web según los permisos (CA-10)", () => {
    expect(fichaEnLaWeb({ id: 42 }, ["activos.ver"]).map((a) => a.ruta)).toEqual(["/admin/activos/42"]);
    // US-023: «Editar» y «Registrar activo» se hacen en la app.
    expect(fichaEnLaWeb({ id: 42 }, ["activos.ver", "activos.editar", "activos.imprimir_etiqueta"]).map((a) => a.ruta)).toEqual([
      "/admin/activos/42?accion=etiqueta",
      "/admin/activos/42",
    ]);
    expect(fichaEnLaWeb({ id: "x" }, ["activos.ver"])).toEqual([]);
    expect(activosEnLaWeb(["activos.ver"]).map((a) => a.nombre)).toEqual(["Tipos de dispositivo"]);
    expect(activosEnLaWeb(["activos.crear", "alertas.ver"]).map((a) => a.nombre)).toEqual([
      "Carga masiva",
      "Alertas",
    ]);
  });
});

describe("asignar (CA-8)", () => {
  const activo = {
    responsables: [{ id: 4, nombre_completo: "Ana Pérez" }],
    departamento: 7,
    sede: 2,
  };

  it("el cuerpo de la web: la lista completa, el área, la sede y el motivo", () => {
    const iniciales = valoresDeAsignacion(activo);
    expect(iniciales).toEqual({ responsables: ["4"], departamento: "7", sede: "2", motivo: "" });
    expect(hayCambioDeAsignacion(iniciales, { ...iniciales, motivo: "x" })).toBe(false);
    const nuevos = { ...iniciales, responsables: ["9"], motivo: " Rotación " };
    expect(hayCambioDeAsignacion(iniciales, nuevos)).toBe(true);
    expect(cuerpoDeAsignacion(nuevos)).toEqual({ responsables: [9], departamento: 7, sede: 2, motivo: "Rotación" });
    expect(cuerpoDeAsignacion({ responsables: [], departamento: "", sede: "", motivo: "" })).toEqual({
      responsables: [],
      departamento: null,
      sede: null,
      motivo: "",
    });
  });

  it("dice qué hará el movimiento", () => {
    const iniciales = valoresDeAsignacion(activo);
    expect(resumenDeAsignacion(iniciales, { ...iniciales, responsables: [] })).toMatch(/^Devolución a bodega/);
    expect(resumenDeAsignacion(iniciales, { ...iniciales, responsables: ["9"] })).toMatch(/quién responde/);
    expect(resumenDeAsignacion(iniciales, { ...iniciales, sede: "3" })).toMatch(/^Traslado/);
    expect(resumenDeAsignacion(iniciales, iniciales)).toBeNull();
  });
});

describe("escáner y solicitudes", () => {
  it("el código leído, limpio; vacío es nada", () => {
    expect(codigoLeido("  GA-LAP-000042\n")).toBe("GA-LAP-000042");
    expect(codigoLeido("   ")).toBeNull();
    expect(codigoLeido(undefined)).toBeNull();
    expect(codigoLeido("x".repeat(300))).toHaveLength(120);
  });

  it("las transiciones de una solicitud (CA-20)", () => {
    expect(transicionesDeSolicitud("pendiente")).toEqual(["en_gestion", "rechazada", "cancelada"]);
    expect(transicionesDeSolicitud("en_gestion")).toEqual(["comprada", "rechazada", "cancelada"]);
    expect(transicionesDeSolicitud("comprada")).toEqual(["entregada"]);
    expect(transicionesDeSolicitud("entregada")).toEqual([]);
    expect(transicionesDeSolicitud("raro")).toEqual([]);
  });
});

describe("errores (CA-2)", () => {
  it("el módulo apagado y la falta de permiso, sin error técnico", () => {
    expect(mensajeDeActivos(error(403, { error: { code: "modulo_apagado", message: "Este módulo está apagado en la empresa." } }), "x")).toBe(
      TEXTO_MODULO_APAGADO,
    );
    expect(
      mensajeDeActivos(error(403, { error: { code: "permission_denied", message: "No tiene el permiso requerido: activos.ver." } }), "x"),
    ).toBe(TEXTO_SIN_PERMISO);
    expect(mensajeDeActivos(error(403, { error: { code: "x", message: "Solo el encargado puede." } }), "x")).toBe("Solo el encargado puede.");
    expect(mensajeDeActivos(error(404, { error: { code: "activo_no_encontrado", message: "Ningún activo corresponde a 'X'." } }), "x")).toBe(
      "Ningún activo corresponde a 'X'.",
    );
  });

  it("en un guardado sin respuesta clara, que pudo haberse hecho", () => {
    const red = Object.assign(new Error("red"), { esDeRed: true });
    expect(mensajeDeActivos(red, "x", { envio: true })).toBe(TEXTO_PUEDE_HABERSE_GUARDADO);
    expect(mensajeDeActivos(red, "x")).toMatch(/No se pudo conectar/);
  });
});

describe("avisos (CA-21)", () => {
  it("activos, mantenimientos, alertas y (desde la Tanda B) solicitudes tienen pantalla en la app", () => {
    expect(MODULOS_EN_APP.activos).toBe(rutaDeActivos);
    expect(MODULOS_EN_APP.mantenimientos).toBe(rutaDeActivos);
    expect(MODULOS_EN_APP.alertas).toBe(rutaDeActivos);
    expect(MODULOS_EN_APP.solicitudes).toBe(rutaDeSolicitudes);
  });

  it("las reparaciones sin cerrar abren la bitácora con «Abiertos»; un mantenimiento, su detalle", () => {
    expect(rutaEnApp({ modulo: "alertas", enlace: "/admin/mantenimientos?pendientes=true" })).toMatch(
      /^\/activos\?vista=mantenimientos&filtro=abiertos&n=\d+$/,
    );
    expect(rutaDeActivos({ enlace: "https://intranet.laarcourier.com/admin/mantenimientos" })).toMatch(
      /^\/activos\?vista=mantenimientos&n=\d+$/,
    );
    expect(rutaDeActivos({ enlace: "/admin/mantenimientos/12", empresa: { id: 3 } })).toBe("/mantenimientos/12?empresa=3");
    expect(rutaDeActivos({ enlace: "/admin/mantenimientos/12/editar" })).toBe("/mantenimientos/12");
  });

  it("una solicitud de equipo abre su detalle con la empresa del aviso; lo demás, sus listas", () => {
    expect(rutaEnApp({ modulo: "solicitudes", enlace: "/admin/solicitudes/42", empresa: 3 })).toBe("/solicitudes/42?empresa=3");
    expect(rutaDeSolicitudes({ enlace: "https://intranet.laarcourier.com/admin/solicitudes/7/" })).toBe("/solicitudes/7");
    expect(rutaDeSolicitudes({ enlace: "/admin/solicitudes/recibidas" })).toMatch(/^\/activos\?vista=recibidas&n=\d+$/);
    expect(rutaDeSolicitudes({ enlace: "/admin/solicitudes/abc" })).toMatch(/^\/activos\?vista=mis_solicitudes&n=\d+$/);
    expect(rutaDeSolicitudes({})).toMatch(/^\/activos\?vista=mis_solicitudes/);
  });

  it("la ficha del activo con la empresa del aviso, también con la web delante", () => {
    expect(rutaEnApp({ modulo: "activos", enlace: "/admin/activos/42", empresa: 3 })).toBe("/activos/42?empresa=3");
    expect(rutaEnApp({ modulo: "mantenimientos", enlace: "https://intranet.laarcourier.com/admin/activos/7/" })).toBe(
      "/activos/7",
    );
    expect(rutaEnApp({ modulo: "activos", enlace: "/admin/activos/abc" })).toMatch(/^\/activos\?vista=panel&n=\d+$/);
  });

  it("el inventario con el filtro de la alerta, o el panel", () => {
    expect(rutaDeActivos({ enlace: "/admin/activos?almacenados=true" })).toMatch(/^\/activos\?vista=inventario&filtro=almacen&n=\d+$/);
    expect(rutaDeActivos({ enlace: "/admin/activos?garantia=por_vencer" })).toMatch(/^\/activos\?vista=inventario&n=\d+$/);
    expect(rutaDeActivos({ enlace: "/admin/alertas" })).toMatch(/^\/activos\?vista=panel&n=\d+$/);
    expect(rutaDeActivos({})).toMatch(/^\/activos\?vista=panel/);
  });
});
