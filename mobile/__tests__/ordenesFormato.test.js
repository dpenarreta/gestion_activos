import { api } from "../src/api/api";
import { crearCliente } from "../src/api/cliente";
import { ordenesService } from "../src/api/servicios";
import { destinoDeNotificacion } from "../src/notificaciones/abrir";
import { MODULOS_EN_APP, rutaDeOrdenes, rutaEnApp } from "../src/notificaciones/modulosEnApp";
import { funcionalidadesVisibles, moduloPorId, modulosVisibles, nombreAccesible } from "../src/navegacion/modulos";
import {
  contactoDe,
  cuantasOrdenes,
  cuerpoDeAsignacion,
  cuerpoDeCorreccion,
  cuerpoDeNuevaOrden,
  cuerpoDelCambioDeEstado,
  cuerpoDelCosto,
  cuerpoDelProveedor,
  cumplimientoDeLaOrden,
  decimalDe,
  detalleDelCosto,
  erroresDelAlta,
  erroresDelProveedor,
  estadoDeLaOrden,
  kpisDelPanel,
  mensajeDeOrdenes,
  moneda,
  muestraCumplimiento,
  nombreDeFila,
  nombreDePestana,
  opcionesDeResponsables,
  ordenesEnLaWeb,
  parametrosDeMisOrdenes,
  pasosDisponibles,
  PESTANAS,
  prioridadDeLaOrden,
  puedeAsignarse,
  resumenDePildoras,
  puedeCrearOrdenes,
  resultadoDeAsignacion,
  resultadoDelPaso,
  TEXTO_FECHA_PASADA,
  TEXTO_MODULO_APAGADO,
  TEXTO_NOTA_OBLIGATORIA,
  TEXTO_OBSERVACIONES_OBLIGATORIAS,
  TEXTO_PROVEEDOR_SIN_ELEGIR,
  TEXTO_PUEDE_HABERSE_GUARDADO,
  TEXTO_RESPONSABLE_SIN_ELEGIR,
  TEXTO_SIN_CONTACTO,
  TEXTO_SIN_FECHA,
  TEXTO_SIN_PERMISO,
  TEXTO_SIN_RESPONSABLE,
  textoDeListaVacia,
  textoDelPaso,
  validarAsignacion,
  validarCambioDeEstado,
  validarCorreccion,
  validarCosto,
  validarNuevaOrden,
  validarProveedor,
  valoresDeAsignacion,
  valoresDeCorreccion,
  valoresDeNuevaOrden,
  veLasOrdenes,
} from "../src/ordenes/formato";
import { opcionesDeNombres, opcionesDeSedes } from "../src/ordenes/useCatalogos";
import { errorDeGuardado } from "../src/pantallas/activos/formularios";
import { fechaCorta } from "../src/utils/fechas";

jest.mock("../src/api/api", () => ({
  api: {
    get: jest.fn(async () => ({})),
    post: jest.fn(async () => ({})),
    patch: jest.fn(async () => ({})),
    delete: jest.fn(async () => ({})),
  },
  escucharSesion: () => () => {},
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useNavigation: () => ({ dispatch: jest.fn() }),
  usePreventRemove: () => {},
  useFocusEffect: () => {},
}));

function error(status, code, message, details = null) {
  const e = new Error(message);
  e.response = { status, data: { error: { code, message, details } } };
  return e;
}

/** Una fila de `OrdenListaSerializer`. */
function orden(campos = {}) {
  return {
    id: 15,
    numero: "OT-2026-000015",
    sede: { id: 3, nombre: "Agencia Ambato", ciudad: "Ambato", region: "sierra", region_display: "Sierra", provincia: "Tungurahua" },
    categoria: "electrico",
    categoria_display: "Eléctrico",
    prioridad: "alta",
    prioridad_display: "Alta",
    estado: "programada",
    estado_display: "Programada",
    titulo: "Sin luz en cajas",
    solicitante: { id: 1, nombre: "Ana Pérez" },
    tecnico: { id: 8, nombre: "Jorge Andrade" },
    proveedor: null,
    responsable: "Jorge Andrade",
    fecha_programada: "2026-11-20",
    cumplimiento: "en_plazo",
    contacto: "•••••••123",
    total: "0.00",
    con_observaciones: false,
    created_at: "2026-11-17T14:00:00Z",
    ...campos,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("CA-1: el módulo y sus vistas, con los permisos de la web", () => {
  function contexto(permisos) {
    return { permisos, licencias: {}, chat: {}, soporte: {}, vistas: {} };
  }

  it("con ordenes.ver hay pestaña «Órdenes de trabajo», a la derecha de las demás, con Panel y Mis órdenes", () => {
    const visibles = modulosVisibles(contexto(["ordenes.ver", "activos.ver"]));
    expect(visibles.map((m) => m.id).slice(-2)).toEqual(["activos", "ordenes"]);
    const modulo = moduloPorId("ordenes");
    expect(modulo.texto).toBe("Órdenes de trabajo");
    expect(funcionalidadesVisibles(modulo, contexto(["ordenes.ver"])).map((f) => f.id)).toEqual(["panel", "mis"]);
  });

  it("«Nueva orden» solo con ordenes.crear; sin ordenes.ver no hay módulo", () => {
    const modulo = moduloPorId("ordenes");
    const conCrear = funcionalidadesVisibles(modulo, contexto(["ordenes.ver", "ordenes.crear"]));
    expect(conCrear.map((f) => f.id)).toEqual(["panel", "mis", "nueva"]);
    expect(conCrear.map((f) => nombreAccesible(f))).toEqual([
      "Panel de mantenimiento",
      "Mis órdenes de trabajo",
      "Nueva orden de trabajo",
    ]);
    expect(conCrear.find((f) => f.id === "nueva")).toMatchObject({ tipo: "accion", ruta: "/ordenes/nueva" });
    expect(modulosVisibles(contexto(["ordenes.crear", "ordenes.gestionar"])).map((m) => m.id)).not.toContain("ordenes");
    expect(veLasOrdenes(["ordenes.crear"])).toBe(false);
    expect(puedeCrearOrdenes(["ordenes.crear"])).toBe(false);
    expect(puedeCrearOrdenes(["ordenes.ver", "ordenes.crear"])).toBe(true);
  });

  it("CA-17: los reportes con ordenes.reportes y el listado completo con ordenes.ver, en la web", () => {
    expect(ordenesEnLaWeb(["ordenes.ver"]).map((a) => a.ruta)).toEqual(["/admin/ordenes/lista"]);
    expect(ordenesEnLaWeb(["ordenes.ver", "ordenes.reportes"]).map((a) => a.ruta)).toEqual([
      "/admin/reportes/ordenes",
      "/admin/ordenes/lista",
    ]);
    expect(ordenesEnLaWeb([])).toEqual([]);
  });
});

describe("estado, prioridad y cumplimiento: texto e ícono, no solo color", () => {
  it("cada uno con su texto (el de la API manda) y su ícono", () => {
    expect(estadoDeLaOrden(orden())).toMatchObject({ texto: "Programada", icono: "calendar-clock" });
    expect(estadoDeLaOrden(orden({ estado: "pendiente_aprobacion", estado_display: "Pendiente de aprobación" })).texto).toBe(
      "Pendiente de aprobación",
    );
    expect(prioridadDeLaOrden(orden()).texto).toBe("Prioridad: Alta");
    expect(cumplimientoDeLaOrden(orden({ cumplimiento: "vencida" }))).toMatchObject({ texto: "Vencida", icono: "clock-alert-outline" });
    expect(cumplimientoDeLaOrden(orden({ cumplimiento: "sin_fecha" })).texto).toBe("Sin fecha");
    for (const o of [estadoDeLaOrden(orden()), prioridadDeLaOrden(orden()), cumplimientoDeLaOrden(orden())]) {
      expect(o.fondo).toBeTruthy();
      expect(o.color).toBeTruthy();
      expect(o.icono).toBeTruthy();
    }
    expect(estadoDeLaOrden({ estado: "raro" }).texto).toBe("raro");
  });

  it("CA-8: la fila se lee entera", () => {
    expect(nombreDeFila(orden(), fechaCorta)).toBe(
      "OT-2026-000015. Sin luz en cajas. Sede: Agencia Ambato · Ambato. Prioridad: Alta. Estado: Programada. Cumplimiento: En plazo. Programada: 20/11/2026. Responsable: Jorge Andrade",
    );
    expect(nombreDeFila(orden({ fecha_programada: null, responsable: "" }), fechaCorta)).toMatch(
      /Sin fecha programada\. Responsable: Sin asignar$/,
    );
  });

  it("UX H-07: el contacto enmascarado se dice sin deletrear; completo, se puede llamar", () => {
    expect(contactoDe(orden())).toEqual({ texto: "•••••••123", dicho: "Teléfono de contacto: oculto, termina en 123", llamar: null });
    expect(contactoDe(orden({ contacto: "099 123 4567" }))).toEqual({
      texto: "099 123 4567",
      dicho: "Teléfono de contacto: 099 123 4567",
      llamar: "tel:0991234567",
    });
    expect(contactoDe(orden({ contacto: "" }))).toEqual({ texto: "—", dicho: "Teléfono de contacto: sin registrar", llamar: null });
    expect(resumenDePildoras(orden())).toBe("Prioridad: Alta. Estado: Programada. Cumplimiento: En plazo");
  });

  it("el dinero: el cero se muestra «$0,00»; «—» solo si no llegó el valor (prueba en el teléfono, 17/11/2026)", () => {
    expect(moneda("0.00")).toBe("$0,00");
    expect(moneda(0)).toBe("$0,00");
    expect(moneda("0")).toBe("$0,00");
    expect(moneda(null)).toBe("—");
    expect(moneda(undefined)).toBe("—");
    expect(moneda("1234.5")).toBe("$1.234,50");
    expect(kpisDelPanel({ costo_total: "0" }).find((k) => k.clave === "costo_total").cifra).toBe("$0,00");
  });

  it("una orden cerrada no repite «Cerrada» en el cumplimiento", () => {
    const cerrada = orden({ estado: "cerrada", estado_display: "Cerrada", cumplimiento: "cerrada" });
    expect(muestraCumplimiento(cerrada)).toBe(false);
    expect(muestraCumplimiento(orden())).toBe(true);
    expect(resumenDePildoras(cerrada)).toBe("Prioridad: Alta. Estado: Cerrada");
    expect(nombreDeFila(cerrada, fechaCorta)).not.toMatch(/Cumplimiento/);
    expect(nombreDeFila(orden(), fechaCorta)).toMatch(/Cumplimiento: En plazo/);
  });
});

describe("CA-3: los indicadores del panel", () => {
  it("los ocho, en el orden de la web; abiertas y vencidas destacadas; el costo en USD", () => {
    const kpis = kpisDelPanel({
      registradas: 12,
      abiertas: 7,
      vencidas: 2,
      cerradas: 5,
      costo_total: "1520.75",
      prioridad_alta: 3,
      pendientes_aprobacion: 1,
      con_observaciones: 0,
    });
    expect(kpis.map((k) => k.titulo)).toEqual([
      "Órdenes registradas",
      "Abiertas",
      "Vencidas",
      "Cerradas",
      "Costo total (con IVA)",
      "Prioridad alta o crítica",
      "Pendientes de aprobación",
      "Con observaciones",
    ]);
    expect(kpis.filter((k) => k.destacada).map((k) => k.clave)).toEqual(["abiertas", "vencidas"]);
    expect(kpis.find((k) => k.clave === "costo_total").cifra).toBe("$1.520,75");
    expect(kpis.find((k) => k.clave === "con_observaciones").cifra).toBe(0);
    expect(kpisDelPanel(undefined).find((k) => k.clave === "registradas").cifra).toBe(0);
  });
});

describe("CA-7: Mis órdenes", () => {
  it("cada pestaña pide sus órdenes abiertas, con búsqueda y página", () => {
    expect(PESTANAS.map((p) => p.texto)).toEqual(["Creadas por mí", "Asignadas a mí"]);
    expect(parametrosDeMisOrdenes({ ambito: "mias" })).toEqual({ ambito: "mias", abiertas: "true" });
    expect(parametrosDeMisOrdenes({ ambito: "asignadas", q: "  ambato ", pagina: 3 })).toEqual({
      ambito: "asignadas",
      abiertas: "true",
      q: "ambato",
      page: 3,
    });
    expect(parametrosDeMisOrdenes({ ambito: "todas" }).ambito).toBe("mias");
  });

  it("el contador y la pestaña vacía, que explica a quien no ejecuta órdenes", () => {
    expect(cuantasOrdenes(1)).toBe("1 orden abierta");
    expect(cuantasOrdenes(4)).toBe("4 órdenes abiertas");
    expect(nombreDePestana(PESTANAS[1], 3)).toBe("Asignadas a mí, 3 órdenes abiertas");
    expect(nombreDePestana(PESTANAS[0], null)).toBe("Creadas por mí");
    expect(textoDeListaVacia("asignadas", { permisos: ["ordenes.ver"] })).toMatch(/no tiene ese permiso/);
    expect(textoDeListaVacia("asignadas", { permisos: ["ordenes.ejecutar"] })).toBe("No tiene órdenes abiertas asignadas a usted.");
    expect(textoDeListaVacia("mias", {})).toBe("No tiene órdenes abiertas creadas por usted.");
    expect(textoDeListaVacia("mias", { busqueda: "luz" })).toBe("Ninguna orden abierta coincide con «luz».");
  });
});

describe("CA-10: los pasos los da el servidor, con el verbo de la web", () => {
  it("los verbos", () => {
    expect(textoDelPaso("programada", "asignada")).toBe("Programar");
    expect(textoDelPaso("en_ejecucion", "programada")).toBe("Iniciar ejecución");
    expect(textoDelPaso("en_ejecucion", "pausada")).toBe("Reanudar");
    expect(textoDelPaso("en_ejecucion", "pendiente_aprobacion")).toBe("Devolver a ejecución");
    expect(textoDelPaso("pausada", "en_ejecucion")).toBe("Pausar");
    expect(textoDelPaso("pendiente_aprobacion", "en_ejecucion")).toBe("Enviar a aprobación");
    expect(textoDelPaso("cerrada", "pendiente_aprobacion")).toBe("Aceptar y cerrar");
  });

  it("UX H-04: lo que hace avanzar va como primario; pausar y devolver, no", () => {
    const enPendiente = orden({ estado: "pendiente_aprobacion", permisos: { acciones: ["en_ejecucion", "cerrada"] } });
    expect(pasosDisponibles(enPendiente).map((p) => [p.destino, p.avanza])).toEqual([
      ["en_ejecucion", false],
      ["cerrada", true],
    ]);
    const enEjecucion = orden({ estado: "en_ejecucion", permisos: { acciones: ["pausada", "pendiente_aprobacion"] } });
    expect(pasosDisponibles(enEjecucion).map((p) => p.avanza)).toEqual([false, true]);
    expect(pasosDisponibles(orden({ estado: "pausada", permisos: { acciones: ["en_ejecucion"] } }))[0].avanza).toBe(true);
  });

  it("solo los de permisos.acciones, sin «asignada»", () => {
    const o = orden({ estado: "pendiente_aprobacion", permisos: { acciones: ["en_ejecucion", "cerrada"] } });
    expect(pasosDisponibles(o).map((p) => p.texto)).toEqual(["Devolver a ejecución", "Aceptar y cerrar"]);
    expect(pasosDisponibles(orden({ permisos: { acciones: ["asignada"] } }))).toEqual([]);
    expect(pasosDisponibles(orden())).toEqual([]);
  });

  it("la nota es obligatoria al pausar, al devolver y al cerrar con observaciones; programar pide la fecha", () => {
    const hoy = "2026-11-17";
    expect(validarCambioDeEstado({ destino: "pausada", actual: "en_ejecucion", nota: " ", hoy })).toEqual({ nota: TEXTO_NOTA_OBLIGATORIA });
    expect(validarCambioDeEstado({ destino: "en_ejecucion", actual: "pendiente_aprobacion", nota: "", hoy }).nota).toBe(
      TEXTO_NOTA_OBLIGATORIA,
    );
    expect(validarCambioDeEstado({ destino: "en_ejecucion", actual: "pausada", nota: "", hoy })).toEqual({});
    expect(validarCambioDeEstado({ destino: "cerrada", actual: "pendiente_aprobacion", conObservaciones: true, hoy }).nota).toBe(
      TEXTO_OBSERVACIONES_OBLIGATORIAS,
    );
    expect(validarCambioDeEstado({ destino: "cerrada", actual: "pendiente_aprobacion", hoy })).toEqual({});
    expect(validarCambioDeEstado({ destino: "programada", actual: "asignada", fecha: "", fechaActual: "", hoy }).fecha_programada).toBeTruthy();
    expect(validarCambioDeEstado({ destino: "programada", actual: "asignada", fecha: "2026-11-10", fechaActual: "", hoy })).toEqual({
      fecha_programada: TEXTO_FECHA_PASADA,
    });
    expect(validarCambioDeEstado({ destino: "programada", actual: "asignada", fecha: "", fechaActual: "2026-11-20", hoy })).toEqual({});
  });

  it("el cuerpo y lo que se anuncia", () => {
    expect(cuerpoDelCambioDeEstado({ destino: "programada", nota: " ok ", fecha: "2026-11-20" })).toEqual({
      estado: "programada",
      nota: "ok",
      fecha_programada: "2026-11-20",
    });
    expect(cuerpoDelCambioDeEstado({ destino: "cerrada", nota: "", conObservaciones: false })).toEqual({
      estado: "cerrada",
      nota: "",
      con_observaciones: false,
    });
    expect(cuerpoDelCambioDeEstado({ destino: "pausada", nota: "Falta repuesto" })).toEqual({ estado: "pausada", nota: "Falta repuesto" });
    expect(resultadoDelPaso("cerrada", "pendiente_aprobacion", true)).toBe("Orden aceptada con observaciones y cerrada.");
    expect(resultadoDelPaso("en_ejecucion", "pendiente_aprobacion")).toBe("Orden devuelta a ejecución.");
    expect(resultadoDelPaso("en_ejecucion", "pausada")).toBe("Orden reanudada.");
    expect(resultadoDelPaso("en_ejecucion", "programada")).toBe("Ejecución iniciada.");
  });
});

describe("CA-11: asignar o reasignar", () => {
  it("solo con permisos.asignar y en un estado que se reasigna", () => {
    expect(puedeAsignarse(orden({ permisos: { asignar: true } }))).toBe(true);
    expect(puedeAsignarse(orden({ estado: "en_ejecucion", permisos: { asignar: true } }))).toBe(false);
    expect(puedeAsignarse(orden({ permisos: { asignar: false } }))).toBe(false);
  });

  it("valida como la web y envía solo lo que cambió", () => {
    const iniciales = valoresDeAsignacion(orden({ proveedor: { id: 4, nombre: "Climas del Sur" } }));
    expect(iniciales).toEqual({ tecnico: "8", proveedor: "4", fecha_programada: "2026-11-20", nota: "" });
    expect(validarAsignacion(iniciales, { ...iniciales, tecnico: "", proveedor: "" }, "2026-11-17").tecnico).toBeTruthy();
    expect(validarAsignacion(iniciales, { ...iniciales, fecha_programada: "" }, "2026-11-17").fecha_programada).toBe(TEXTO_SIN_FECHA);
    expect(validarAsignacion(iniciales, { ...iniciales, fecha_programada: "2026-11-01" }, "2026-11-17").fecha_programada).toBe(
      TEXTO_FECHA_PASADA,
    );
    expect(cuerpoDeAsignacion(iniciales, { ...iniciales, tecnico: "9", nota: " urgente " })).toEqual({ tecnico: 9, nota: "urgente" });
    expect(cuerpoDeAsignacion(iniciales, { ...iniciales, proveedor: "" })).toEqual({ proveedor: null });
    const reprogramar = cuerpoDeAsignacion(iniciales, { ...iniciales, fecha_programada: "2026-11-25" });
    expect(reprogramar).toEqual({ fecha_programada: "2026-11-25" });
    expect(resultadoDeAsignacion(orden(), reprogramar)).toBe("Orden reprogramada.");
    expect(resultadoDeAsignacion(orden(), { tecnico: 9 })).toBe("Orden reasignada.");
    expect(resultadoDeAsignacion(orden({ tecnico: null }), { tecnico: 9 })).toBe("Orden asignada.");
  });

  it("las opciones conservan a quien ya está aunque no venga en el catálogo", () => {
    expect(opcionesDeNombres([{ id: 2, nombre: "Luis" }], { id: 8, nombre: "Jorge" })).toEqual([
      { valor: "8", texto: "Jorge" },
      { valor: "2", texto: "Luis" },
    ]);
    expect(opcionesDeSedes([{ id: 3, nombre: "Agencia Ambato", ciudad: "Ambato", region_display: "Sierra" }])).toEqual([
      { valor: "3", texto: "Agencia Ambato", detalle: "Ambato · Sierra" },
    ]);
  });
});

describe("CA-12: materiales y horas, con coma o punto decimal", () => {
  it("los números", () => {
    expect(decimalDe("12,5")).toBe("12.5");
    expect(decimalDe(" 3.25 ")).toBe("3.25");
    expect(decimalDe("1.000,50")).toBeNull();
    expect(decimalDe("2,505")).toBeNull();
    expect(decimalDe("-1")).toBeNull();
  });

  it("valida y arma el cuerpo con punto", () => {
    expect(validarCosto("materiales", { descripcion: "", cantidad: "0", costo_unitario: "abc" })).toEqual({
      descripcion: "Escriba el material.",
      cantidad: "Debe ser al menos 0,01.",
      costo_unitario: expect.stringMatching(/^Escriba un número/),
    });
    expect(validarCosto("mano-de-obra", { descripcion: "Cableado", horas: "0,2", costo_hora: "0" })).toEqual({
      horas: "Debe ser al menos 0,25.",
    });
    expect(validarCosto("materiales", { descripcion: "Foco", cantidad: "2", costo_unitario: "3,50" })).toEqual({});
    // QA-TECH: los dígitos enteros que admite la base.
    expect(validarCosto("mano-de-obra", { descripcion: "x", horas: "9999,75", costo_hora: "99999999" })).toEqual({});
    expect(validarCosto("mano-de-obra", { descripcion: "x", horas: "10000", costo_hora: "123456789" })).toEqual({
      horas: "Es demasiado grande: como mucho 4 dígitos antes de la coma.",
      costo_hora: "Es demasiado grande: como mucho 8 dígitos antes de la coma.",
    });
    expect(validarCosto("materiales", { descripcion: "x", cantidad: "123456789", costo_unitario: "12345678901" })).toEqual({
      cantidad: "Es demasiado grande: como mucho 8 dígitos antes de la coma.",
      costo_unitario: "Es demasiado grande: como mucho 10 dígitos antes de la coma.",
    });
    expect(validarCosto("materiales", { descripcion: "x", cantidad: "00000001", costo_unitario: "1" })).toEqual({});
    expect(cuerpoDelCosto("materiales", { descripcion: " Foco LED ", cantidad: "2", costo_unitario: "3,50" })).toEqual({
      descripcion: "Foco LED",
      cantidad: "2",
      costo_unitario: "3.50",
    });
    expect(cuerpoDelCosto("mano-de-obra", { descripcion: "Cableado", horas: "1,5", costo_hora: "8" })).toEqual({
      descripcion: "Cableado",
      horas: "1.5",
      costo_hora: "8",
    });
    expect(detalleDelCosto("materiales", { cantidad: "2.50", costo_unitario: "3.50" })).toBe("2,5 × $3,50");
    expect(detalleDelCosto("mano-de-obra", { horas: "1.00", costo_hora: "8.00" })).toBe("1 hora × $8,00");
  });
});

describe("CA-13: corregir", () => {
  it("el teléfono solo si el servidor lo da completo; se envía solo lo que cambió", () => {
    expect("telefono_contacto" in valoresDeCorreccion(orden({ telefono_contacto_editable: null }))).toBe(false);
    const iniciales = valoresDeCorreccion(orden({ descripcion: "Caja 2", telefono_contacto_editable: "0991234567" }));
    expect(iniciales).toEqual({
      titulo: "Sin luz en cajas",
      descripcion: "Caja 2",
      categoria: "electrico",
      prioridad: "alta",
      sede: "3",
      telefono_contacto: "0991234567",
    });
    expect(validarCorreccion({ ...iniciales, titulo: " ", telefono_contacto: "12" })).toEqual({
      titulo: "Diga qué hay que hacer.",
      telefono_contacto: "Escriba un teléfono de 7 a 15 dígitos.",
    });
    expect(cuerpoDeCorreccion(iniciales, { ...iniciales, titulo: " Sin luz en caja 1 ", sede: "5" })).toEqual({
      titulo: "Sin luz en caja 1",
      sede: 5,
    });
    expect(cuerpoDeCorreccion(iniciales, { ...iniciales })).toEqual({});
  });
});

describe("CA-14 y CA-15: nueva orden y proveedor nuevo", () => {
  const hoy = "2026-11-17";

  it("valida lo de la web antes de enviar", () => {
    const vacia = validarNuevaOrden({ valores: valoresDeNuevaOrden(), responsable: null, hoy });
    expect(vacia).toEqual({
      sede: "Elija la sede.",
      categoria: "Elija la categoría.",
      titulo: "Diga qué hay que hacer.",
      responsable: TEXTO_SIN_RESPONSABLE,
      fecha_programada: TEXTO_SIN_FECHA,
    });
    const valores = { ...valoresDeNuevaOrden(), sede: "3", categoria: "electrico", titulo: "Luz", fecha_programada: "2026-11-10", telefono_contacto: "099" };
    expect(validarNuevaOrden({ valores, responsable: null, textoResponsable: "Jor", hoy })).toEqual({
      telefono_contacto: "Escriba un teléfono de 7 a 15 dígitos.",
      responsable: TEXTO_RESPONSABLE_SIN_ELEGIR,
      fecha_programada: TEXTO_FECHA_PASADA,
    });
    expect(
      validarNuevaOrden({
        valores: { ...valores, telefono_contacto: "", fecha_programada: hoy },
        responsable: { tipo: "persona", id: 8, nombre: "Jorge" },
        conProveedor: true,
        proveedorDePersona: null,
        textoProveedor: "Clim",
        hoy,
      }),
    ).toEqual({ proveedor: TEXTO_PROVEEDOR_SIN_ELEGIR });
  });

  it("el cuerpo: con una persona, técnico y su proveedor; con un proveedor, solo proveedor", () => {
    const valores = { ...valoresDeNuevaOrden(), sede: "3", categoria: "electrico", titulo: " Luz ", fecha_programada: "2026-11-20" };
    expect(cuerpoDeNuevaOrden(valores, { tipo: "persona", id: 8 }, { id: 4, nombre: "Climas" })).toEqual({
      sede: 3,
      categoria: "electrico",
      prioridad: "media",
      titulo: "Luz",
      descripcion: "",
      telefono_contacto: "",
      fecha_programada: "2026-11-20",
      tecnico: 8,
      proveedor: 4,
    });
    expect(cuerpoDeNuevaOrden(valores, { tipo: "proveedor", id: 4 }, null)).toMatchObject({ tecnico: null, proveedor: 4 });
  });

  it("los 400 del alta van a «Quién la realiza»", () => {
    expect(erroresDelAlta({ tecnico: "Esa persona no puede ejecutar órdenes." }, true)).toEqual({
      responsable: "Esa persona no puede ejecutar órdenes.",
    });
    expect(erroresDelAlta({ proveedor: "Ese proveedor está desactivado: elija otro." }, false)).toEqual({
      responsable: "Ese proveedor está desactivado: elija otro.",
    });
    expect(erroresDelAlta({ proveedor: "Desactivado." }, true)).toEqual({ proveedor: "Desactivado." });
  });

  it("los resultados del buscador, en dos grupos", () => {
    const datos = {
      proveedores: [{ id: 4, nombre: "Climas del Sur" }],
      personas: [{ id: 8, nombre: "Jorge Andrade", proveedor: { id: 4, nombre: "Climas del Sur" } }],
    };
    expect(opcionesDeResponsables(datos)).toEqual({
      proveedores: [{ tipo: "proveedor", id: 4, nombre: "Climas del Sur", proveedor: null }],
      personas: [{ tipo: "persona", id: 8, nombre: "Jorge Andrade", proveedor: { id: 4, nombre: "Climas del Sur" } }],
    });
    expect(opcionesDeResponsables(datos, { soloProveedores: true }).personas).toEqual([]);
  });

  it("el proveedor: nombre y teléfono o correo; cédula o RUC si es un número", () => {
    expect(validarProveedor({ nombre: "", telefono: "", correo: "", identificacion: "" })).toEqual({
      nombre: "Escriba el nombre o la razón social.",
      medio: TEXTO_SIN_CONTACTO,
    });
    expect(validarProveedor({ nombre: "Climas", telefono: "12", correo: "x@", identificacion: "123" })).toEqual({
      telefono: "Escriba un teléfono de 7 a 15 dígitos.",
      correo: "Escriba un correo válido, como nombre@empresa.com.",
      identificacion: "Escriba la cédula (10 dígitos) o el RUC (13 dígitos).",
    });
    expect(validarProveedor({ nombre: "Climas", telefono: "", correo: "a@b.ec", identificacion: "EXT-99" })).toEqual({});
    expect(cuerpoDelProveedor({ nombre: " Climas ", contacto: "", telefono: " 0991234567 ", correo: "", identificacion: "" })).toEqual({
      nombre: "Climas",
      contacto: "",
      telefono: "0991234567",
      correo: "",
      identificacion: "",
    });
    expect(erroresDelProveedor({ telefono: TEXTO_SIN_CONTACTO }, { telefono: "", correo: "" })).toEqual({ medio: TEXTO_SIN_CONTACTO });
    expect(erroresDelProveedor({ telefono: "Corto." }, { telefono: "12", correo: "" })).toEqual({ telefono: "Corto." });
  });
});

describe("CA-2: los errores dicen el módulo", () => {
  it("módulo apagado, sin permiso, el mensaje propio del servidor y lo que pudo guardarse", () => {
    expect(mensajeDeOrdenes(error(403, "modulo_apagado", "Apagado."), "x")).toBe(TEXTO_MODULO_APAGADO);
    expect(mensajeDeOrdenes(error(403, "permission_denied", "No tiene el permiso requerido: ordenes.ver."), "x")).toBe(TEXTO_SIN_PERMISO);
    expect(mensajeDeOrdenes(error(403, "permission_denied", "Esta orden la ejecuta el técnico asignado, o quien coordina."), "x")).toBe(
      "Esta orden la ejecuta el técnico asignado, o quien coordina.",
    );
    const red = Object.assign(new Error("red"), { esDeRed: true });
    expect(mensajeDeOrdenes(red, "x", { envio: true })).toBe(TEXTO_PUEDE_HABERSE_GUARDADO);
  });

  it("errorDeGuardado con las opciones de órdenes (aditivas: Activos sigue igual)", () => {
    const red = Object.assign(new Error("red"), { esDeRed: true });
    const opciones = { mensaje: mensajeDeOrdenes, textoDudoso: TEXTO_PUEDE_HABERSE_GUARDADO };
    expect(errorDeGuardado(red, "x", {}, opciones)).toMatchObject({ texto: TEXTO_PUEDE_HABERSE_GUARDADO, dudoso: true });
    expect(errorDeGuardado(error(403, "modulo_apagado", "Apagado."), "x", {}, opciones).texto).toBe(TEXTO_MODULO_APAGADO);
    expect(errorDeGuardado(error(403, "modulo_apagado", "Apagado."), "x", {}).texto).toBe(
      "Gestión de Activos no está activa en su empresa.",
    );
  });
});

describe("ordenesService: las mismas rutas que la web (views.py)", () => {
  it("lecturas", async () => {
    await ordenesService.listar({ ambito: "mias", abiertas: "true" });
    await ordenesService.detalle(15);
    await ordenesService.detalle(15, { empresa: "3" });
    await ordenesService.resumen();
    await ordenesService.catalogos();
    await ordenesService.responsables("  jor ");
    await ordenesService.responsables("clim", { soloProveedores: true });
    expect(api.get.mock.calls).toEqual([
      ["/ordenes/", { params: { ambito: "mias", abiertas: "true" } }],
      ["/ordenes/15/", undefined],
      ["/ordenes/15/", { cabeceras: { "X-Empresa": "3" } }],
      ["/ordenes/resumen/"],
      ["/ordenes/catalogos/"],
      ["/ordenes/responsables/", { params: { q: "jor" } }],
      ["/ordenes/responsables/", { params: { q: "clim", solo: "proveedores" } }],
    ]);
  });

  it("escrituras", async () => {
    await ordenesService.crear({ titulo: "Luz" });
    await ordenesService.corregir(15, { titulo: "Luz" });
    await ordenesService.asignar(15, { tecnico: 8 });
    await ordenesService.cambiarEstado(15, { estado: "pausada", nota: "x" });
    await ordenesService.agregarMaterial(15, { descripcion: "Foco" });
    await ordenesService.agregarManoDeObra(15, { descripcion: "Cableado" });
    await ordenesService.registrarProveedor({ nombre: "Climas" });
    await ordenesService.quitarCosto(15, "materiales", 3);
    await ordenesService.quitarCosto(15, "mano-de-obra", 4);
    expect(api.post.mock.calls).toEqual([
      ["/ordenes/", { titulo: "Luz" }],
      ["/ordenes/15/asignar/", { tecnico: 8 }],
      ["/ordenes/15/cambiar-estado/", { estado: "pausada", nota: "x" }],
      ["/ordenes/15/materiales/", { descripcion: "Foco" }],
      ["/ordenes/15/mano-de-obra/", { descripcion: "Cableado" }],
      ["/ordenes/proveedores/", { nombre: "Climas" }],
    ]);
    expect(api.patch.mock.calls).toEqual([["/ordenes/15/", { titulo: "Luz" }]]);
    expect(api.delete.mock.calls).toEqual([["/ordenes/15/costos/materiales/3/"], ["/ordenes/15/costos/mano-de-obra/4/"]]);
  });

  it("el cliente HTTP manda un DELETE sin cuerpo", async () => {
    const fetchImpl = jest.fn(async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ id: 15 }) }));
    const cliente = crearCliente({
      baseUrl: "https://api.prueba/api/v1",
      almacen: { tokens: () => ({ access: "a", refresh: "r" }), guardarTokens: jest.fn(), empresa: () => "2" },
      userAgent: "IntranetLCE/1.0.0 (android)",
      fetchImpl,
      alTerminarSesion: jest.fn(),
    });
    await expect(cliente.delete("/ordenes/15/costos/materiales/3/")).resolves.toEqual({ id: 15 });
    const [url, opciones] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.prueba/api/v1/ordenes/15/costos/materiales/3/");
    expect(opciones.method).toBe("DELETE");
    expect(opciones.body).toBeUndefined();
    expect(opciones.headers["Content-Type"]).toBeUndefined();
  });
});

describe("los avisos de órdenes abren la ficha en la app (US-025)", () => {
  it("«ordenes» está en el mapa", () => {
    expect(MODULOS_EN_APP.ordenes).toBe(rutaDeOrdenes);
  });

  it("los dos avisos del backend (asignada y creada) llevan /admin/ordenes/lista/ID: van a la ficha, con la empresa", () => {
    for (const tipo of ["ordenes.asignada", "ordenes.creada"]) {
      expect(rutaEnApp({ id: 1, modulo: "ordenes", tipo, enlace: "/admin/ordenes/lista/15", empresa: { id: 3 } })).toBe(
        "/ordenes/15?empresa=3",
      );
    }
    expect(rutaEnApp({ id: 1, modulo: "ordenes", enlace: "/admin/ordenes/lista/15/" })).toBe("/ordenes/15");
    expect(rutaEnApp({ id: 1, modulo: "ordenes", enlace: "https://intranet.laarcourier.com/admin/ordenes/lista/15?x=1#a", empresa: 7 })).toBe(
      "/ordenes/15?empresa=7",
    );
    expect(destinoDeNotificacion({ id: 1, modulo: "ordenes", enlace: "/admin/ordenes/lista/15" })).toBe("/ordenes/15");
  });

  it("cualquier otro enlace (o uno raro) va al panel, con la empresa del aviso; nunca a una ficha con un ID que no es número", () => {
    expect(rutaDeOrdenes({ enlace: "/admin/ordenes/panel", empresa: { id: 3 } })).toMatch(/^\/ordenes\?vista=panel&n=\d+&empresa=3$/);
    expect(rutaDeOrdenes({ enlace: "/admin/ordenes/lista/nueva" })).toMatch(/^\/ordenes\?vista=panel&n=\d+$/);
    expect(rutaDeOrdenes({ enlace: "/admin/ordenes/lista/15/../9" })).toMatch(/^\/ordenes\?vista=panel/);
    expect(rutaDeOrdenes({ enlace: "/admin/ordenes/lista/1234567890123" })).toMatch(/^\/ordenes\?vista=panel/);
    expect(rutaDeOrdenes({})).toMatch(/^\/ordenes\?vista=panel/);
  });
});
