import * as FileSystem from "expo-file-system";

import { CARPETAS_DE_DESCARGAS } from "../src/adjuntos/descargas";
import { api } from "../src/api/api";
import { activosService, adjuntosService, mantenimientosService, solicitudesService } from "../src/api/servicios";
import {
  descargarAdjuntoDeActivo,
  TEXTO_ADJUNTO_NO_DISPONIBLE,
  TEXTO_ADJUNTO_SIN_PERMISO,
  TEXTO_ARCHIVO_GRANDE,
  TEXTO_ARCHIVO_NO_PERMITIDO,
  validarArchivoDeActivo,
} from "../src/activos/adjuntos";
import { dejarResultado, tomarResultado } from "../src/activos/avisoPendiente";
import {
  cuerpoDelCierre,
  cuerpoDelComponente,
  cuerpoDelRegistro,
  diasEntre,
  diasFuera,
  erroresDeLineas,
  estadoDelMantenimiento,
  hayCambiosEnElRegistro,
  lineaDe,
  montoDe,
  nombreDeFilaMantenimiento,
  parametrosDeMantenimientos,
  piezasCriticas,
  quienRecibeElAviso,
  resultadoDelCierre,
  textoDelAvisoDeMantenimiento,
  totalDeRepuestos,
  validarCierre,
  validarComponenteNuevo,
  validarLineas,
  validarRegistro,
  valoresIniciales,
} from "../src/activos/mantenimientos";
import {
  accionesDeSolicitud,
  caracteristicasDe,
  confirmacionDelPaso,
  cuerpoDeSolicitud,
  erroresDeEspecificaciones,
  especificacionDe,
  estadoDeSolicitud,
  hayCambiosEnLaSolicitud,
  nombreDeFilaSolicitud,
  parametrosDeSolicitudes,
  prioridadDe,
  queSePide,
  textoDelAvisoDeSolicitud,
  validarSolicitud,
  valorDeEspecificacion,
  valoresDeSolicitud,
} from "../src/activos/solicitudes";

jest.mock("../src/api/api", () => ({
  api: {
    get: jest.fn(async () => ({})),
    post: jest.fn(async () => ({})),
    patch: jest.fn(async () => ({})),
    url: (ruta) => `https://api.prueba/api/v1${ruta}`,
    conRenovacion: jest.fn(async (hacer, { empresa } = {}) =>
      hacer({ Authorization: "Bearer access", ...(empresa ? { "X-Empresa": empresa } : {}) }),
    ),
  },
  escucharSesion: () => () => {},
}));

function error400(details) {
  const e = new Error("Error en la solicitud.");
  e.response = { status: 400, data: { error: { code: "validation_error", message: "Error en la solicitud.", details } } };
  return e;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// --- Servicios ----------------------------------------------------------------------

describe("servicios de la Tanda B", () => {
  it("la bitácora, el detalle, el registro, el cierre y el catálogo van a sus rutas", async () => {
    await mantenimientosService.listar({ pendientes: "true", page: 2 });
    await mantenimientosService.detalle(9, { empresa: 3 });
    await mantenimientosService.registrar({ activo: 1 });
    await mantenimientosService.cerrar(9, { fecha_salida: "2026-11-16" });
    await mantenimientosService.componentes("  disco ");
    await mantenimientosService.crearComponente({ nombre: "Disco" });
    await activosService.buscarOperativos(" GA-1 ");

    expect(api.get.mock.calls).toEqual([
      ["/mantenimientos/", { params: { pendientes: "true", page: 2 } }],
      ["/mantenimientos/9/", { cabeceras: { "X-Empresa": "3" } }],
      ["/mantenimientos/componentes/", { params: { page_size: 50, q: "disco" } }],
      ["/activos/", { params: { operativos: "true", q: "GA-1" } }],
    ]);
    expect(api.post.mock.calls).toEqual([
      ["/mantenimientos/", { activo: 1 }],
      ["/mantenimientos/componentes/", { nombre: "Disco" }],
    ]);
    expect(api.patch).toHaveBeenCalledWith("/mantenimientos/9/", { fecha_salida: "2026-11-16" });
  });

  it("las solicitudes de equipo: lista, detalle, alta, paso, catálogo y encargados", async () => {
    await solicitudesService.listar({ ambito: "mias" });
    await solicitudesService.detalle(4, { empresa: 2 });
    await solicitudesService.catalogo();
    await solicitudesService.encargados();
    await solicitudesService.crear({ cantidad: 1 });
    await solicitudesService.cambiarEstado(4, { estado: "rechazada", nota: "No hay presupuesto" });
    await solicitudesService.cambiarEstado(4, { estado: "cancelada" }, { empresa: 2 });

    expect(api.get.mock.calls.map((c) => c[0])).toEqual([
      "/solicitudes/",
      "/solicitudes/4/",
      "/solicitudes/catalogo/",
      "/solicitudes/encargados/",
    ]);
    expect(api.post.mock.calls).toEqual([
      ["/solicitudes/", { cantidad: 1 }],
      ["/solicitudes/4/cambiar-estado/", { estado: "rechazada", nota: "No hay presupuesto" }, undefined],
      ["/solicitudes/4/cambiar-estado/", { estado: "cancelada", nota: "" }, { cabeceras: { "X-Empresa": "2" } }],
    ]);
  });

  it("un adjunto va en multipart con activo, mantenimiento, tipo y el archivo en «archivo»", async () => {
    await adjuntosService.listar({ mantenimiento: 9 });
    expect(api.get).toHaveBeenCalledWith("/adjuntos/", { params: { activo: undefined, mantenimiento: 9, page_size: 100 } });

    await adjuntosService.subir({
      activo: 42,
      mantenimiento: 9,
      tipo: "foto",
      descripcion: "Pantalla rota",
      archivo: { uri: "file:///cache/ImagePicker/a.jpg", name: "a.jpg", type: "image/jpeg" },
    });
    const [ruta, cuerpo, opciones] = api.post.mock.calls[0];
    expect(ruta).toBe("/adjuntos/");
    expect(cuerpo.getParts()).toEqual([
      { fieldName: "activo", string: "42" },
      { fieldName: "mantenimiento", string: "9" },
      { fieldName: "tipo", string: "foto" },
      { fieldName: "descripcion", string: "Pantalla rota" },
      { fieldName: "archivo", uri: "file:///cache/ImagePicker/a.jpg", name: "a.jpg", type: "image/jpeg" },
    ]);
    expect(opciones.timeoutMs).toBeGreaterThan(20000);
  });
});

// --- Adjuntos -----------------------------------------------------------------------

describe("adjuntos (CA-17)", () => {
  it("valida extensión y 10 MB como el servidor", () => {
    expect(validarArchivoDeActivo({ uri: "file:///x/informe.pdf", nombre: "informe.pdf", tipo: "application/pdf", tamano: 1000 }).archivo)
      .toEqual({ uri: "file:///x/informe.pdf", name: "informe.pdf", type: "application/pdf", size: 1000 });
    expect(validarArchivoDeActivo({ uri: "file:///x/a.exe", nombre: "a.exe", tipo: "application/x-msdownload", tamano: 10 }).error).toBe(
      TEXTO_ARCHIVO_NO_PERMITIDO,
    );
    expect(validarArchivoDeActivo({ uri: "file:///x/b.jpg", nombre: "b.jpg", tipo: "image/jpeg", tamano: 10 * 1024 * 1024 + 1 }).error).toBe(
      TEXTO_ARCHIVO_GRANDE,
    );
  });

  it("descarga con la sesión a su carpeta (que se borra al cerrar sesión) y traduce los errores", async () => {
    expect(CARPETAS_DE_DESCARGAS).toContain("activos-adjuntos");
    const archivo = await descargarAdjuntoDeActivo({ id: 5, nombre_original: "foto.PNG" }, { empresa: 3 });
    expect(archivo.uri).toBe("file:///cache/activos-adjuntos/adjunto-5.png");
    const [url, , opciones] = FileSystem.File.downloadFileAsync.mock.calls[0];
    expect(url).toBe("https://api.prueba/api/v1/adjuntos/5/descargar/");
    expect(opciones.headers).toEqual({ Authorization: "Bearer access", "X-Empresa": 3 });

    const raro = await descargarAdjuntoDeActivo({ id: 6, nombre_original: "script.sh" });
    expect(raro.uri).toBe("file:///cache/activos-adjuntos/adjunto-6.bin");

    FileSystem.File.downloadFileAsync.mockRejectedValueOnce(new Error("response has status: 404"));
    await expect(descargarAdjuntoDeActivo({ id: 7, nombre_original: "a.pdf" })).rejects.toThrow(TEXTO_ADJUNTO_NO_DISPONIBLE);
    FileSystem.File.downloadFileAsync.mockRejectedValueOnce(new Error("response has status: 403"));
    await expect(descargarAdjuntoDeActivo({ id: 7, nombre_original: "a.pdf" })).rejects.toThrow(TEXTO_ADJUNTO_SIN_PERMISO);
    await expect(descargarAdjuntoDeActivo({ id: "1/../2", nombre_original: "a.pdf" })).rejects.toThrow(TEXTO_ADJUNTO_NO_DISPONIBLE);
  });

  it("el resultado de un alta se toma una sola vez", () => {
    dejarResultado("mantenimiento-3", { texto: "Listo" });
    expect(tomarResultado("mantenimiento-3")).toEqual({ texto: "Listo" });
    expect(tomarResultado("mantenimiento-3")).toBeNull();
  });
});

// --- Mantenimientos -----------------------------------------------------------------

describe("la bitácora (CA-13)", () => {
  const abierto = {
    id: 2,
    activo_codigo: "GA-LAP-000042",
    activo_nombre: "Laptop Dell",
    tipo: "correctivo",
    tipo_display: "Correctivo",
    fecha_intervencion: "2026-11-10",
    fecha_salida: null,
    costo_total: "15.00",
  };
  const cerrado = {
    ...abierto,
    id: 1,
    fecha_salida: "2026-11-12",
    dias_fuera_de_operacion: 2,
    estado_final: "no_reparable",
    estado_final_display: "No reparable",
  };

  it("los parámetros: abiertos o cerrados con `pendientes`, el tipo y la búsqueda", () => {
    expect(parametrosDeMantenimientos({ filtro: "abiertos", tipo: "preventivo", q: "  disco ", pagina: 2 })).toEqual({
      pendientes: "true",
      tipo: "preventivo",
      q: "disco",
      page: 2,
    });
    expect(parametrosDeMantenimientos({ filtro: "cerrados", tipo: "otro" })).toEqual({ pendientes: "false", page: 1 });
    expect(parametrosDeMantenimientos({ filtro: "raro" })).toEqual({ page: 1 });
  });

  it("abierto o cerrado con texto e ícono; días fuera solo si cerró; el nombre accesible lo dice todo", () => {
    expect(estadoDelMantenimiento(abierto)).toMatchObject({ texto: "Abierto", abierto: true, icono: "progress-wrench" });
    expect(estadoDelMantenimiento(cerrado)).toMatchObject({ texto: "No reparable", abierto: false, icono: "close-circle-outline" });
    expect(diasFuera(abierto)).toBeNull();
    expect(diasFuera(cerrado)).toBe("2 días fuera de operación");
    expect(nombreDeFilaMantenimiento(abierto)).toBe(
      "GA-LAP-000042, Laptop Dell. Correctivo. Estado: Abierto. Desde el 10/11/2026 · sigue fuera de operación. Costo: $15,00",
    );
  });
});

describe("registrar (CA-14, CA-15)", () => {
  const HOY = "2026-11-16";
  const valores = { ...valoresIniciales(HOY), responsable: "  Luis ", descripcion: "Cambio de disco", costo_mano_obra: "25,5" };

  it("valida lo obligatorio, la fecha no futura ni anterior a la compra y los montos", () => {
    expect(validarRegistro({ activo: { id: 1 }, valores, hoy: HOY, fechaAdquisicion: "2025-01-15" })).toEqual({});
    const errores = validarRegistro({
      activo: null,
      valores: { ...valoresIniciales(HOY), fecha_intervencion: "2026-11-17", costo_mano_obra: "1.000,00" },
      hoy: HOY,
    });
    expect(Object.keys(errores).sort()).toEqual(["activo", "costo_mano_obra", "descripcion", "fecha_intervencion", "responsable"]);
    expect(errores.fecha_intervencion).toBe("La fecha de intervención no puede ser futura.");
    expect(
      validarRegistro({ activo: { id: 1 }, valores: { ...valores, fecha_intervencion: "2024-12-01" }, hoy: HOY, fechaAdquisicion: "2025-01-15" })
        .fecha_intervencion,
    ).toMatch(/anterior a la fecha de adquisición del activo \(15\/01\/2025\)/);
    expect(
      validarRegistro({ activo: { id: 1 }, valores: { ...valores, fecha_salida: "2026-11-01", fecha_intervencion: "2026-11-05" }, hoy: HOY })
        .fecha_salida,
    ).toBe("La salida no puede ser anterior al ingreso.");
  });

  it("los repuestos: cantidad entera ≥ 1 y costo como monto", () => {
    const lineas = [{ ...lineaDe({ id: 3, nombre: "Disco", es_critico: true }), cantidad: "0", costo_unitario: "abc" }];
    expect(validarLineas(lineas)).toEqual([
      { cantidad: "La cantidad es un número entero de al menos 1.", costo_unitario: expect.any(String) },
    ]);
    expect(validarRegistro({ activo: { id: 1 }, valores, lineas, hoy: HOY }).componentes).toBe("Revise los repuestos marcados.");
  });

  it("el cuerpo como el de la web: salida vacía es null, sin proveedor por línea, montos con punto", () => {
    const lineas = [{ ...lineaDe({ id: 3, nombre: "Disco", es_critico: true }), cantidad: "2", costo_unitario: "40,5", numero_serie_nuevo: " S1 " }];
    expect(cuerpoDelRegistro({ activo: "42", valores, lineas })).toEqual({
      activo: 42,
      tipo: "correctivo",
      fecha_intervencion: "2026-11-16",
      fecha_salida: null,
      tipo_responsable: "tecnico_interno",
      responsable: "Luis",
      causa: "",
      descripcion: "Cambio de disco",
      diagnostico: "",
      solucion: "",
      estado_final: "reparado",
      garantia_usada: false,
      costo_mano_obra: "25.5",
      componentes: [{ componente: 3, cantidad: 2, costo_unitario: "40.5", numero_serie_nuevo: "S1", observaciones: "" }],
    });
    expect(totalDeRepuestos(lineas)).toBe(81);
    expect(piezasCriticas(lineas)).toBe(2);
    expect(montoDe("")).toBeNull();
    expect(Number.isNaN(montoDe("-3"))).toBe(true);
  });

  it("hay cambios si se escribió algo o se agregó un repuesto", () => {
    const iniciales = valoresIniciales(HOY);
    expect(hayCambiosEnElRegistro(iniciales, iniciales, [])).toBe(false);
    expect(hayCambiosEnElRegistro(iniciales, { ...iniciales, causa: "x" }, [])).toBe(true);
    expect(hayCambiosEnElRegistro(iniciales, iniciales, [{}])).toBe(true);
  });

  it("los 400 de cada repuesto se reparten por línea", () => {
    expect(erroresDeLineas(error400({ componentes: [{}, { cantidad: ["Asegúrese de que este valor sea mayor o igual a 1."] }] }))).toEqual({
      lineas: [{}, { cantidad: "Asegúrese de que este valor sea mayor o igual a 1." }],
      general: null,
    });
    expect(erroresDeLineas(error400({ componentes: ["Lista inválida."] }))).toEqual({ lineas: [], general: "Lista inválida." });
    expect(erroresDeLineas(error400({ responsable: ["x"] }))).toEqual({ lineas: [], general: null });
  });

  it("a quién se avisará antes y a quién no se avisó después, sin direcciones", () => {
    expect(quienRecibeElAviso({ responsables: [] })).toBe("Nadie responde por este equipo, así que el aviso le llegará a usted.");
    expect(
      quienRecibeElAviso({
        responsables: [
          { nombre_completo: "Ana Pérez", recibe_avisos: true },
          { nombre_completo: "Luis Mora", recibe_avisos: false },
        ],
      }),
    ).toBe("Se avisará por correo a Ana Pérez. Luis Mora no tiene correo en su ficha y no recibirá el aviso.");
    expect(textoDelAvisoDeMantenimiento({ enviados: 0, sin_correo: ["Ana", "Luis"] })).toBe(
      "Ana y Luis no tienen correo en su ficha y no recibieron el aviso.",
    );
    expect(textoDelAvisoDeMantenimiento({ enviados: 1, sin_correo: [] })).toBeNull();
  });

  it("crear componente: nombre y código obligatorios; el código va en mayúsculas", () => {
    expect(Object.keys(validarComponenteNuevo({ nombre: " ", codigo: "" }))).toEqual(["nombre", "codigo"]);
    expect(cuerpoDelComponente({ nombre: " Disco SSD ", codigo: " disco-ssd ", descripcion: "", es_critico: 1 })).toEqual({
      nombre: "Disco SSD",
      codigo: "DISCO-SSD",
      descripcion: "",
      es_critico: true,
    });
  });
});

describe("cerrar (CA-16)", () => {
  const m = { fecha_intervencion: "2026-11-10" };

  it("la salida no es futura ni anterior al ingreso; el cuerpo solo lleva lo de la salida", () => {
    const HOY = "2026-11-16";
    expect(validarCierre(m, { fecha_salida: "2026-11-12", estado_final: "reparado" }, HOY)).toEqual({});
    expect(validarCierre(m, { fecha_salida: "2026-11-17", estado_final: "reparado" }, HOY).fecha_salida).toBe(
      "La fecha de salida no puede ser futura.",
    );
    expect(validarCierre(m, { fecha_salida: "2026-11-09", estado_final: "x" }, HOY)).toEqual({
      fecha_salida: "La salida no puede ser anterior al ingreso.",
      estado_final: "Elija el estado final.",
    });
    expect(cuerpoDelCierre({ fecha_salida: "2026-11-12", solucion: " Se cambió ", estado_final: "reparado", otro: 1 })).toEqual({
      fecha_salida: "2026-11-12",
      solucion: "Se cambió",
      estado_final: "reparado",
    });
    expect(diasEntre("2026-11-10", "2026-11-12")).toBe(2);
    expect(resultadoDelCierre({ estado_final: "no_reparable" })).toMatch(/sigue «En reparación»/);
    expect(resultadoDelCierre({ estado_final: "reparado" })).toMatch(/vuelve al estado/);
  });
});

// --- Solicitudes --------------------------------------------------------------------

describe("solicitudes (CA-18 a CA-20)", () => {
  const s = {
    id: 4,
    solicitante: 10,
    encargado: 20,
    estado: "pendiente",
    lo_que_se_pide: "Laptop — con 32 GB",
    cantidad: 2,
    prioridad: "alta",
    prioridad_display: "Alta",
    encargado_nombre: "Rosa Díaz",
    solicitante_nombre: "Ana Pérez",
    fecha_necesaria: "2026-12-01",
  };

  it("parámetros, estado y prioridad con texto e ícono, y el nombre accesible", () => {
    expect(parametrosDeSolicitudes({ ambito: "recibidas", filtro: "abiertas", q: " lap " })).toEqual({
      ambito: "recibidas",
      abiertas: "true",
      q: "lap",
      page: 1,
    });
    expect(parametrosDeSolicitudes({ ambito: "otro", filtro: "todas", pagina: 3 })).toEqual({ ambito: "mias", page: 3 });
    expect(estadoDeSolicitud("rechazada")).toMatchObject({ texto: "Rechazada", icono: "close-circle-outline" });
    expect(prioridadDe(s)).toMatchObject({ texto: "Prioridad: Alta", icono: "chevron-double-up" });
    expect(queSePide(s)).toBe("2 × Laptop — con 32 GB");
    expect(nombreDeFilaSolicitud(s, "recibidas")).toBe(
      "Solicitud 4. 2 × Laptop — con 32 GB. Estado: Pendiente. Prioridad: Alta. Pidió: Ana Pérez. Se necesita para el 01/12/2026",
    );
  });

  it("solo las transiciones válidas y de quien puede: encargado, administrador o quien la pidió", () => {
    expect(accionesDeSolicitud(s, { usuarioId: 20, permisos: ["solicitudes.gestionar"] })).toEqual({
      pasos: ["en_gestion", "rechazada"],
      cancelar: false,
    });
    // Gestionar no alcanza para lo ajeno.
    expect(accionesDeSolicitud(s, { usuarioId: 30, permisos: ["solicitudes.gestionar"] })).toEqual({ pasos: [], cancelar: false });
    expect(accionesDeSolicitud(s, { usuarioId: 10, permisos: ["solicitudes.crear"] })).toEqual({ pasos: [], cancelar: true });
    expect(accionesDeSolicitud({ ...s, estado: "comprada" }, { usuarioId: 30, permisos: ["solicitudes.administrar"] })).toEqual({
      pasos: ["entregada"],
      cancelar: false,
    });
    expect(accionesDeSolicitud({ ...s, estado: "entregada" }, { usuarioId: 10, permisos: ["solicitudes.administrar"] })).toEqual({
      pasos: [],
      cancelar: false,
    });
    expect(confirmacionDelPaso("cancelada", s).titulo).toBe("¿Cancelar la solicitud?");
  });

  it("las especificaciones según el dato de cada característica", () => {
    expect(especificacionDe({ nombre: "RAM", dato: "entero" }, "32")).toEqual({ valor: 32 });
    expect(especificacionDe({ nombre: "RAM", dato: "entero" }, "32,5").error).toBe("«RAM» es un número entero.");
    expect(especificacionDe({ nombre: "Peso", dato: "numero" }, "1,5")).toEqual({ valor: 1.5 });
    expect(especificacionDe({ nombre: "SO", dato: "lista", opciones: ["Windows 11"] }, "Linux").error).toBe("Elija una opción de «SO».");
    expect(especificacionDe({ nombre: "Táctil", dato: "booleano" }, false)).toEqual({ valor: false });
    expect(especificacionDe({ nombre: "Notas", dato: "texto" }, "  ")).toEqual({ valor: undefined });
    expect(valorDeEspecificacion(true)).toBe("Sí");
    expect(valorDeEspecificacion("2026-12-01")).toBe("01/12/2026");
  });

  const CATALOGO = {
    tipos_dispositivo: [
      {
        id: 1,
        nombre: "Laptop",
        caracteristicas: [
          { id: 11, nombre: "RAM", dato: "entero", unidad: "GB", opciones: [], obligatoria: true, orden: 1 },
          { id: 12, nombre: "SO", dato: "lista", unidad: "", opciones: ["Windows 11"], obligatoria: false, orden: 2 },
        ],
      },
    ],
    componentes: [{ id: 5, nombre: "Disco SSD" }],
  };

  it("valida catálogo o detalle, cantidad, encargado, justificación y las características obligatorias", () => {
    const vacia = valoresDeSolicitud();
    expect(hayCambiosEnLaSolicitud(vacia)).toBe(false);
    const errores = validarSolicitud({ ...vacia, cantidad: "0" }, CATALOGO, "2026-11-16");
    expect(Object.keys(errores).sort()).toEqual(["cantidad", "detalle", "encargado", "justificacion", "tipo_dispositivo"]);

    const conTipo = { ...vacia, tipo_dispositivo: "1", encargado: "20", justificacion: "Entra alguien", especificaciones: {} };
    expect(caracteristicasDe(CATALOGO, conTipo).map((c) => c.nombre)).toEqual(["RAM", "SO"]);
    expect(validarSolicitud(conTipo, CATALOGO, "2026-11-16").especificaciones).toEqual({
      RAM: "«RAM» es obligatoria para este tipo de equipo.",
    });
    const lista = { ...conTipo, especificaciones: { RAM: "32", SO: "Windows 11" }, fecha_necesaria: "2026-12-01" };
    expect(validarSolicitud(lista, CATALOGO, "2026-11-16")).toEqual({});
    expect(cuerpoDeSolicitud(lista, CATALOGO)).toEqual({
      clase: "dispositivo",
      tipo_dispositivo: 1,
      componente: null,
      detalle: "",
      especificaciones: { RAM: 32, SO: "Windows 11" },
      cantidad: 1,
      prioridad: "media",
      fecha_necesaria: "2026-12-01",
      encargado: 20,
      justificacion: "Entra alguien",
    });
    // Un componente o algo escrito a mano no lleva características.
    const aMano = { ...vacia, clase: "componente", detalle: "Cable HDMI de 5 m", encargado: "20", justificacion: "Sala" };
    expect(validarSolicitud(aMano, CATALOGO, "2026-11-16")).toEqual({});
    expect(cuerpoDeSolicitud(aMano, CATALOGO)).toMatchObject({ clase: "componente", tipo_dispositivo: null, componente: null, especificaciones: {} });
  });

  it("los 400 de las características y el aviso sin correo", () => {
    expect(erroresDeEspecificaciones(error400({ especificaciones: { RAM: "«RAM» es obligatoria." } }))).toEqual({
      RAM: "«RAM» es obligatoria.",
    });
    expect(erroresDeEspecificaciones(error400({ justificacion: ["x"] }))).toEqual({});
    expect(textoDelAvisoDeSolicitud({ enviado_a: 0, sin_correo: ["Rosa Díaz"] }, { creada: true })).toMatch(/^No se pudo avisar por correo a Rosa Díaz/);
    expect(textoDelAvisoDeSolicitud({ enviado_a: 1, sin_correo: [] })).toBeNull();
  });
});

// --- Ronda 1 de correcciones tras QA (16/11/2026) -----------------------------------

describe("ronda 1: formato", () => {
  const { activoDelCodigo, codigoFueraDeRuta, codigoLeido, resumenDelEscaneo } = jest.requireActual("../src/activos/formato");
  const { olvidarResultados } = jest.requireActual("../src/activos/avisoPendiente");

  it("QA-FUNC B5: «.» y «..» no son un código; «.» o «/» van por la búsqueda del inventario", () => {
    expect(codigoLeido(".")).toBeNull();
    expect(codigoLeido(" .. ")).toBeNull();
    expect(codigoLeido("A.1")).toBe("A.1");
    expect(codigoFueraDeRuta("GA-LAP-000042")).toBe(false);
    expect(codigoFueraDeRuta("SN.1/A")).toBe(true);
    const a = { id: 1, codigo_barras: "GA-1", numero_serie: "SN.1" };
    const b = { id: 2, codigo_barras: "GA-2", numero_serie: "SN.10" };
    // Siempre exacto: una sola coincidencia parcial no basta (QA-TECH, revalidación).
    expect(activoDelCodigo([a], "x")).toBeNull();
    expect(activoDelCodigo([a, b], "sn.1")).toBe(a);
    expect(activoDelCodigo([a, b], "SN")).toBeNull();
    expect(activoDelCodigo([], "SN")).toBeNull();
  });

  it("UX H-05: el resumen del escáner dice estado, responsable y lugar", () => {
    expect(resumenDelEscaneo({ codigo_barras: "GA-1", nombre: "Laptop", estado: "en_bodega", departamento_nombre: "TI" })).toBe(
      "Activo encontrado: GA-1, Laptop. Estado: En bodega. Responsable: sin asignar. Lugar: TI",
    );
  });

  it("«¿Ya salió?» en «Sí» exige la fecha; con «No», lo de la salida no se envía", () => {
    const HOY = "2026-11-16";
    const valores = { ...valoresIniciales(HOY), responsable: "L", descripcion: "D" };
    expect(validarRegistro({ activo: { id: 1 }, valores, hoy: HOY, salio: true }).fecha_salida).toBe(
      "Elija la fecha en que el equipo salió del taller.",
    );
    expect(
      cuerpoDelRegistro({ activo: 1, valores: { ...valores, fecha_salida: HOY, solucion: "x", estado_final: "no_reparable" }, salio: false }),
    ).toMatchObject({ fecha_salida: null, solucion: "", estado_final: "reparado" });
  });

  it("UX H-11: cada repuesto tiene su clave estable; UX H-16: la prioridad media no es un aviso", () => {
    const uno = lineaDe({ id: 3, nombre: "Disco" });
    const otro = lineaDe({ id: 3, nombre: "Disco" });
    expect(uno.uid).not.toBe(otro.uid);
    expect(prioridadDe({ prioridad: "media", prioridad_display: "Media" }).icono).toBe("equal");
    expect(prioridadDe({ prioridad: "media" }).fondo).toBe(prioridadDe({ prioridad: "baja" }).fondo);
  });

  it("al cerrar sesión se olvidan los resultados pendientes (LOPDP)", () => {
    dejarResultado("solicitud-9", { texto: "x" });
    olvidarResultados();
    expect(tomarResultado("solicitud-9")).toBeNull();
  });
});
