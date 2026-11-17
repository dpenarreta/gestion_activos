import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import { AccessibilityInfo, Alert, Dimensions, StyleSheet } from "react-native";

import { ordenesService } from "../src/api/servicios";
import { confirmarSalida } from "../src/navegador/confirmarSalida";
import {
  TEXTO_MODULO_APAGADO,
  TEXTO_NADA_PENDIENTE,
  TEXTO_NO_DISPONIBLE,
  TEXTO_NOTA_OBLIGATORIA,
  TEXTO_PUEDE_HABERSE_GUARDADO,
  TEXTO_SIN_PERMISO_CREAR,
  TEXTO_SIN_RESPONSABLE,
} from "../src/ordenes/formato";
import { TEXTO_REENVIO, TITULO_REENVIO } from "../src/pantallas/activos/formularios";
import { TITULO_QUITAR_COSTO } from "../src/pantallas/ordenes/AccionesDeLaOrden";
import { OrdenesDeTrabajo } from "../src/pantallas/ordenes/OrdenesDeTrabajo";
import PantallaFicha from "../src/app/(app)/ordenes/[id]";
import PantallaNueva from "../src/app/(app)/ordenes/nueva";
import { coloresClarosEn, olvidarApariencia, renderEnOscuro } from "./utilidades/modoOscuro";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() };
const mockNavegacion = { setOptions: jest.fn(), dispatch: jest.fn() };
const mockParametros = {};
/** Lo último que la pantalla pidió a `usePreventRemove`. */
const mockPrevenir = { activa: false, alIntentar: null };
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    useNavigation: () => mockNavegacion,
    usePreventRemove: (activa, alIntentar) => {
      mockPrevenir.activa = activa;
      mockPrevenir.alIntentar = alIntentar;
    },
    useLocalSearchParams: () => mockParametros,
    useIsFocused: () => true,
    useFocusEffect: (efecto) => React.useEffect(efecto, [efecto]),
  };
});

const mockSesion = {
  usuario: { id: 10, permissions: [] },
  empresaActiva: { id: 2 },
  versionEmpresa: 0,
  empresas: [],
  cambiarEmpresaSiEsSuya: jest.fn(async () => true),
};
jest.mock("../src/sesion/SesionContext", () => ({ useSesion: () => mockSesion }));

jest.mock("../src/navegacion/useContextoDeNavegacion", () => ({
  useContextoDeNavegacion: () => ({ permisos: mockSesion.usuario.permissions, vistas: {} }),
}));

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});

jest.mock("../src/navegador/confirmarSalida", () => ({
  confirmarSalida: jest.fn(async () => true),
  TITULO_SALIR: "¿Salir al navegador?",
  TEXTO_SALIR: "x",
}));

jest.mock("../src/api/servicios", () => ({
  ordenesService: {
    resumen: jest.fn(),
    listar: jest.fn(),
    detalle: jest.fn(),
    catalogos: jest.fn(),
    responsables: jest.fn(),
    crear: jest.fn(),
    corregir: jest.fn(),
    asignar: jest.fn(),
    cambiarEstado: jest.fn(),
    agregarMaterial: jest.fn(),
    agregarManoDeObra: jest.fn(),
    quitarCosto: jest.fn(),
    registrarProveedor: jest.fn(),
  },
}));

function error(status, code, message, details = null) {
  const e = new Error(message);
  e.response = { status, data: { error: { code, message, details } } };
  return e;
}

const SEDE = { id: 3, nombre: "Agencia Ambato", ciudad: "Ambato", region: "sierra", region_display: "Sierra", provincia: "Tungurahua" };

/** Una fila de `OrdenListaSerializer`. */
function fila(campos = {}) {
  return {
    id: 15,
    numero: "OT-2026-000015",
    sede: SEDE,
    categoria: "electrico",
    categoria_display: "Eléctrico",
    prioridad: "alta",
    prioridad_display: "Alta",
    estado: "en_ejecucion",
    estado_display: "En ejecución",
    titulo: "Sin luz en cajas",
    solicitante: { id: 1, nombre: "Ana Pérez" },
    tecnico: { id: 10, nombre: "Jorge Andrade" },
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

/** Un `OrdenDetalleSerializer`. */
function detalle(campos = {}) {
  return {
    ...fila(),
    descripcion: "Desde el lunes, la caja 2.",
    telefono_contacto_editable: null,
    fecha_cierre: null,
    observaciones_cierre: "",
    materiales: [{ id: 3, descripcion: "Foco LED", cantidad: "2.00", costo_unitario: "3.50", subtotal: "7.00" }],
    mano_de_obra: [],
    movimientos: [
      {
        id: 1,
        descripcion: "Solicitó la orden OT-2026-000015",
        nota: "",
        actor: "Ana Pérez",
        estado_anterior: "",
        estado_nuevo: "solicitada",
        created_at: "2026-11-17T14:00:00Z",
      },
      {
        id: 2,
        descripcion: "Asignó OT-2026-000015 a Jorge Andrade para el 2026-11-20",
        nota: "Urgente",
        actor: "Coordinación",
        estado_anterior: "solicitada",
        estado_nuevo: "programada",
        created_at: "2026-11-17T14:05:00Z",
      },
    ],
    costos: { materiales: "7.00", mano_de_obra: "0.00", subtotal: "7.00", iva_porcentaje: 15, iva: "1.05", total: "8.05" },
    permisos: { editar: false, asignar: false, registrar_costos: true, acciones: ["pausada", "pendiente_aprobacion"] },
    ...campos,
  };
}

function pagina(resultados, count = resultados.length, next = null) {
  return { count, next, previous: null, results: resultados };
}

const CATALOGOS = {
  sedes: [SEDE, { id: 5, nombre: "Bodega Manta", ciudad: "Manta", region_display: "Costa" }],
  categorias: [
    { valor: "electrico", etiqueta: "Eléctrico" },
    { valor: "climatizacion", etiqueta: "Climatización" },
  ],
  prioridades: [
    { valor: "critica", etiqueta: "Crítica" },
    { valor: "alta", etiqueta: "Alta" },
    { valor: "media", etiqueta: "Media" },
    { valor: "baja", etiqueta: "Baja" },
  ],
  estados: [],
  puede: { crear: true, gestionar: true },
  alcance: "Todas las sedes de la empresa.",
  tecnicos: [
    { id: 10, nombre: "Jorge Andrade" },
    { id: 11, nombre: "Luis Mora" },
  ],
  proveedores: [{ id: 4, nombre: "Climas del Sur" }],
};

const RESUMEN = {
  kpis: {
    registradas: 12,
    abiertas: 7,
    vencidas: 2,
    cerradas: 5,
    costo_total: "1520.75",
    prioridad_alta: 3,
    pendientes_aprobacion: 1,
    con_observaciones: 0,
  },
  atencion: [fila({ cumplimiento: "vencida" })],
  actividad: [
    {
      id: 9,
      descripcion: "Aceptó y cerró OT-2026-000014",
      nota: "",
      actor: "Ana Pérez",
      estado_nuevo: "cerrada",
      created_at: "2026-11-17T15:00:00Z",
      orden: { id: 14, numero: "OT-2026-000014" },
    },
  ],
  alcance: "Solo las órdenes que usted solicitó y las asignadas a usted.",
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  for (const clave of Object.keys(mockParametros)) delete mockParametros[clave];
  mockSesion.usuario = { id: 10, permissions: ["ordenes.ver"] };
  mockSesion.empresaActiva = { id: 2 };
  mockSesion.versionEmpresa = 0;
  mockSesion.empresas = [];
  mockPrevenir.activa = false;
  mockPrevenir.alIntentar = null;
  // `clearAllMocks` no borra las respuestas «Once» que un caso dejó sin usar.
  for (const metodo of Object.values(ordenesService)) metodo.mockReset();
  ordenesService.catalogos.mockResolvedValue(CATALOGOS);
  ordenesService.responsables.mockResolvedValue({ proveedores: [], personas: [] });
});

describe("Panel de mantenimiento (CA-3 a CA-6)", () => {
  it("el alcance, los ocho indicadores con texto, «Requieren atención» y «Actividad reciente», que abren la ficha", async () => {
    mockParametros.vista = "panel";
    ordenesService.resumen.mockResolvedValueOnce(RESUMEN);
    await render(<OrdenesDeTrabajo />);
    expect(await screen.findByText(`Alcance: ${RESUMEN.alcance}`)).toBeTruthy();
    expect(screen.getByText("Panel de mantenimiento")).toBeTruthy();
    expect(screen.getByTestId("kpi-abiertas").props.accessibilityLabel).toBe("Abiertas: 7");
    expect(screen.getByTestId("kpi-vencidas").props.accessibilityLabel).toBe("Vencidas: 2");
    // Prueba en el teléfono (17/11/2026): la cifra destacada no pierde la
    // negrita (su estilo trae el peso, no solo el tamaño).
    const cifraAbiertas = within(screen.getByTestId("kpi-abiertas")).getByText("7");
    const estilosCifra = [cifraAbiertas.props.style].flat(Infinity).filter(Boolean);
    const [cifra, destacada] = [estilosCifra[0], estilosCifra.at(-1)];
    expect(destacada.fontSize).toBe(32);
    // El mismo peso (o la misma familia de Poppins) que las demás cifras.
    expect(destacada.fontWeight ?? destacada.fontFamily).toBe(cifra.fontWeight ?? cifra.fontFamily);
    expect(cifra.fontWeight ?? cifra.fontFamily).toBeTruthy();
    expect(screen.getByTestId("kpi-costo_total").props.accessibilityLabel).toBe("Costo total (con IVA): $1.520,75");
    expect(within(screen.getByTestId("kpis-ordenes")).getAllByText(/./).length).toBeGreaterThan(8);

    // UX H-01: la misma fila que «Mis órdenes» (título, fecha y responsable).
    const atencion = screen.getByTestId("atencion-15");
    expect(atencion.props.accessibilityLabel).toBe(
      "OT-2026-000015. Sin luz en cajas. Sede: Agencia Ambato · Ambato. Prioridad: Alta. Estado: En ejecución. Cumplimiento: Vencida. Programada: 20/11/2026. Responsable: Jorge Andrade",
    );
    // UX H-05: el costo a todo el ancho; con letra normal, las demás dos por
    // fila, y con la letra grande (Jest corre con fontScale 2), una por fila.
    const base = (id) => StyleSheet.flatten(screen.getByTestId(id).props.style).flexBasis;
    const ventana = Dimensions.get("window");
    try {
      expect(base("kpi-abiertas")).toBe("100%");
      await act(async () => Dimensions.set({ window: { ...ventana, fontScale: 1 }, screen: { ...Dimensions.get("screen"), fontScale: 1 } }));
      expect(base("kpi-costo_total")).toBe("100%");
      expect(base("kpi-abiertas")).toBe("45%");
    } finally {
      await act(async () => Dimensions.set({ window: ventana, screen: Dimensions.get("screen") }));
    }
    await fireEvent.press(atencion);
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: "/ordenes/[id]", params: { id: "15" } });

    const actividad = screen.getByTestId("actividad-9");
    // UX H-06: el número de la orden primero.
    expect(actividad.props.accessibilityLabel).toMatch(/^OT-2026-000014\. Aceptó y cerró OT-2026-000014\. Ana Pérez, /);
    expect(within(actividad).getAllByText("OT-2026-000014")).toHaveLength(1);
    await fireEvent.press(actividad);
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: "/ordenes/[id]", params: { id: "14" } });
  });

  it("sin nada que atender lo dice; sin ordenes.reportes no ofrece los reportes", async () => {
    ordenesService.resumen.mockResolvedValueOnce({ ...RESUMEN, atencion: [], actividad: [] });
    await render(<OrdenesDeTrabajo />);
    expect(await screen.findByText(TEXTO_NADA_PENDIENTE)).toBeTruthy();
    expect(screen.getByText("Todavía no hay movimientos.")).toBeTruthy();
    expect(screen.queryByTestId("web-/admin/reportes/ordenes")).toBeNull();
    expect(screen.getByTestId("web-/admin/ordenes/lista")).toBeTruthy();
  });

  it("CA-17: los reportes se abren en el navegador, con confirmación de salida", async () => {
    mockSesion.usuario.permissions = ["ordenes.ver", "ordenes.reportes"];
    ordenesService.resumen.mockResolvedValueOnce(RESUMEN);
    await render(<OrdenesDeTrabajo />);
    const boton = await screen.findByTestId("web-/admin/reportes/ordenes");
    expect(boton.props.accessibilityRole).toBe("link");
    expect(boton.props.accessibilityLabel).toBe("Reportes y exportación. Abrir en el navegador");
    await fireEvent.press(boton);
    await waitFor(() => expect(confirmarSalida).toHaveBeenCalled());
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/reportes\/ordenes\?empresa=2$/)));
  });

  it("un aviso de otra empresa de la persona pasa la app a ella y lo dice; de una ajena, avisa", async () => {
    mockParametros.vista = "panel";
    mockParametros.empresa = "7";
    mockParametros.n = "1";
    mockSesion.empresas = [{ id: 7, nombre: "Laar Express" }];
    ordenesService.resumen.mockResolvedValue(RESUMEN);
    const { unmount } = await render(<OrdenesDeTrabajo />);
    expect(await screen.findByText("Este aviso es de Laar Express: la app pasó a esa empresa.")).toBeTruthy();
    expect(mockSesion.cambiarEmpresaSiEsSuya).toHaveBeenCalledWith("7");
    await unmount();

    mockParametros.empresa = "99";
    mockParametros.n = "2";
    await render(<OrdenesDeTrabajo />);
    expect(await screen.findByTestId("aviso-de-empresa")).toBeTruthy();
    expect(screen.getByText(/empresa a la que ya no tiene acceso/)).toBeTruthy();
  });

  it("CA-2 y CA-6: el módulo apagado se dice claro, con «Reintentar»", async () => {
    ordenesService.resumen.mockRejectedValueOnce(error(403, "modulo_apagado", "Módulo apagado."));
    ordenesService.resumen.mockResolvedValueOnce(RESUMEN);
    await render(<OrdenesDeTrabajo />);
    expect(await screen.findByText(TEXTO_MODULO_APAGADO)).toBeTruthy();
    await fireEvent.press(screen.getByText("Reintentar"));
    expect(await screen.findByTestId("kpis-ordenes")).toBeTruthy();
  });
});

describe("Mis órdenes (CA-7, CA-8)", () => {
  function listarSegun({ mias = [], asignadas = [] } = {}) {
    ordenesService.listar.mockImplementation(async (params) => {
      const lista = params.ambito === "asignadas" ? asignadas : mias;
      const filtrada = params.q ? lista.filter((o) => o.titulo.toLowerCase().includes(params.q.toLowerCase())) : lista;
      return pagina(params.page_size === 1 ? filtrada.slice(0, 1) : filtrada, filtrada.length);
    });
  }

  it("dos pestañas con su contador; «Creadas por mí» primero y la fila lo dice todo", async () => {
    mockParametros.vista = "mis";
    listarSegun({ mias: [fila({ id: 21, titulo: "Fuga en baño" })], asignadas: [fila(), fila({ id: 16, titulo: "Aire de bodega" })] });
    await render(<OrdenesDeTrabajo />);
    const filaOrden = await screen.findByTestId("orden-21");
    expect(filaOrden.props.accessibilityLabel).toMatch(/^OT-2026-000015\. Fuga en baño\. Sede: Agencia Ambato · Ambato\. Prioridad: Alta/);
    expect(ordenesService.listar).toHaveBeenCalledWith({ ambito: "mias", abiertas: "true" });
    expect(ordenesService.listar).toHaveBeenCalledWith({ ambito: "asignadas", abiertas: "true", page_size: 1 });
    // QA-TECH: la pestaña activa no se cuenta aparte: lo dice su lista.
    expect(ordenesService.listar).not.toHaveBeenCalledWith({ ambito: "mias", abiertas: "true", page_size: 1 });
    await waitFor(() => expect(screen.getByTestId("pestana-asignadas").props.accessibilityLabel).toBe("Asignadas a mí, 2 órdenes abiertas"));
    expect(screen.getByTestId("pestana-mias").props.accessibilityLabel).toBe("Creadas por mí, 1 orden abierta");
    expect(screen.getByTestId("pestana-mias").props.accessibilityState).toEqual({ selected: true });

    await fireEvent.press(screen.getByTestId("pestana-asignadas"));
    expect(await screen.findByTestId("orden-16")).toBeTruthy();
    expect(screen.queryByTestId("orden-21")).toBeNull();
    expect(ordenesService.listar).toHaveBeenCalledWith({ ambito: "asignadas", abiertas: "true" });
    await fireEvent.press(screen.getByTestId("orden-16"));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: "/ordenes/[id]", params: { id: "16" } });
  });

  it("«Asignadas a mí» vacía explica por qué a quien no ejecuta órdenes", async () => {
    mockParametros.vista = "mis";
    mockParametros.pestana = "asignadas";
    listarSegun();
    await render(<OrdenesDeTrabajo />);
    expect(await screen.findByText(/Solo las reciben quienes ejecutan órdenes/)).toBeTruthy();
  });

  it("busca con «Buscar» del teclado sin esperar, y dice cuántas coinciden", async () => {
    mockParametros.vista = "mis";
    listarSegun({ mias: [fila({ id: 21, titulo: "Fuga en baño" }), fila({ id: 22, titulo: "Pintura" })] });
    await render(<OrdenesDeTrabajo />);
    await screen.findByTestId("orden-22");
    await fireEvent.changeText(screen.getByTestId("buscar-orden"), "fuga");
    await fireEvent(screen.getByTestId("buscar-orden"), "submitEditing");
    await waitFor(() => expect(ordenesService.listar).toHaveBeenCalledWith({ ambito: "mias", abiertas: "true", q: "fuga" }));
    await waitFor(() => expect(screen.queryByTestId("orden-22")).toBeNull());
    expect(screen.getByTestId("mis-ordenes-total").props.children).toBe("1 orden abierta");
  });
});

describe("La ficha (CA-9 a CA-13)", () => {
  it("los datos, el contacto como llega, los costos con IVA y el recorrido", async () => {
    ordenesService.detalle.mockResolvedValueOnce(detalle());
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    expect(await screen.findByText("Sin luz en cajas")).toBeTruthy();
    expect(ordenesService.detalle).toHaveBeenCalledWith("15", { empresa: undefined });
    // UX H-07: enmascarado, no se deletrean los puntos ni se ofrece llamar.
    expect(screen.getByTestId("contacto").props.accessibilityLabel).toBe("Teléfono de contacto: oculto, termina en 123");
    expect(screen.queryByTestId("llamar")).toBeNull();
    expect(screen.getByTestId("pildoras-de-la-orden").props.accessibilityLabel).toBe(
      "Prioridad: Alta. Estado: En ejecución. Cumplimiento: En plazo",
    );
    expect(screen.getByLabelText("Responsable: Jorge Andrade")).toBeTruthy();
    expect(screen.getByLabelText("Programada: 20/11/2026")).toBeTruthy();
    expect(screen.getByLabelText("IVA (15 %): $1,05")).toBeTruthy();
    expect(screen.getByLabelText("Total: $8,05")).toBeTruthy();
    expect(screen.getByLabelText("Foco LED. 2 × $3,50. Subtotal: $7,00")).toBeTruthy();
    expect(screen.getByTestId("movimiento-2").props.accessibilityLabel).toMatch(/Nota: Urgente$/);
    // Los botones son los de `permisos.acciones`, con el verbo de la web.
    // UX H-04: lo que hace avanzar es el primario; pausar, secundario.
    const fondo = (id) => StyleSheet.flatten(screen.getByTestId(id).props.style).backgroundColor;
    expect(fondo("paso-pendiente_aprobacion")).toBe("#1E1E1E");
    expect(fondo("paso-pausada")).not.toBe("#1E1E1E");
    expect(screen.getByText("Enviar a aprobación")).toBeTruthy();
    expect(screen.queryByTestId("paso-cerrada")).toBeNull();
    expect(screen.queryByTestId("asignar")).toBeNull();
    expect(screen.queryByTestId("corregir")).toBeNull();
  });

  it("CA-10: «Pausar» exige el motivo; con él envía, pinta la respuesta y lo anuncia", async () => {
    ordenesService.detalle.mockResolvedValueOnce(detalle());
    ordenesService.cambiarEstado.mockResolvedValueOnce(
      detalle({ estado: "pausada", estado_display: "Pausada", permisos: { ...detalle().permisos, acciones: ["en_ejecucion"] } }),
    );
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("paso-pausada"));
    await fireEvent.press(screen.getByTestId("guardar-paso"));
    // El aviso nombra el campo como se ve.
    expect(await screen.findByText("Revise el campo: Motivo.")).toBeTruthy();
    expect(screen.getByTestId("paso-nota").props.accessibilityLabel).toMatch(`Error: ${TEXTO_NOTA_OBLIGATORIA}`);
    expect(ordenesService.cambiarEstado).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId("paso-nota"), "Falta el repuesto");
    await fireEvent.press(screen.getByTestId("guardar-paso"));
    await waitFor(() =>
      expect(ordenesService.cambiarEstado).toHaveBeenCalledWith(15, { estado: "pausada", nota: "Falta el repuesto" }),
    );
    expect(await screen.findByText("Orden pausada.")).toBeTruthy();
    expect(screen.queryByTestId("ventana-paso")).toBeNull();
    expect(screen.getByText("Reanudar")).toBeTruthy();
  });

  it("CA-10: «Aceptar y cerrar» con observaciones las pide y las envía", async () => {
    ordenesService.detalle.mockResolvedValueOnce(
      detalle({ estado: "pendiente_aprobacion", estado_display: "Pendiente de aprobación", permisos: { acciones: ["en_ejecucion", "cerrada"] } }),
    );
    ordenesService.cambiarEstado.mockResolvedValueOnce(detalle({ estado: "cerrada", estado_display: "Cerrada", permisos: { acciones: [] } }));
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    expect(await screen.findByText("Devolver a ejecución")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("paso-cerrada"));
    await fireEvent.press(screen.getByTestId("paso-observaciones"));
    await fireEvent.press(screen.getByTestId("guardar-paso"));
    // Prueba en el teléfono (17/11/2026): el aviso dice «Observaciones», la
    // etiqueta que se ve, y se va al corregir el campo.
    expect(await screen.findByText("Revise el campo: Observaciones.")).toBeTruthy();
    expect(screen.getByTestId("paso-nota").props.accessibilityLabel).toMatch(/^Observaciones \(obligatorio\)/);
    await fireEvent.changeText(screen.getByTestId("paso-nota"), "Quedó una mancha");
    expect(screen.queryByTestId("paso-error")).toBeNull();
    expect(screen.queryByText("Revise el campo: Observaciones.")).toBeNull();
    await fireEvent.press(screen.getByTestId("guardar-paso"));
    await waitFor(() =>
      expect(ordenesService.cambiarEstado).toHaveBeenCalledWith(15, { estado: "cerrada", nota: "Quedó una mancha", con_observaciones: true }),
    );
    expect(await screen.findByText("Orden aceptada con observaciones y cerrada.")).toBeTruthy();
  });

  it("CA-10: el 400 del servidor va junto a su campo; sin respuesta clara, pregunta antes de reenviar", async () => {
    ordenesService.detalle.mockResolvedValueOnce(detalle());
    ordenesService.cambiarEstado
      .mockRejectedValueOnce(error(400, "validation_error", "Error en la solicitud.", { nota: ["Diga el motivo."] }))
      .mockRejectedValueOnce(Object.assign(new Error("red"), { esDeRed: true }));
    const alerta = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("paso-pendiente_aprobacion"));
    await fireEvent.press(screen.getByTestId("guardar-paso"));
    expect(await screen.findByText("Revise el campo: Nota.")).toBeTruthy();
    expect(screen.getByTestId("paso-nota").props.accessibilityLabel).toMatch(/Error: Diga el motivo\./);
    await fireEvent.press(screen.getByTestId("guardar-paso"));
    expect(await screen.findByText(TEXTO_PUEDE_HABERSE_GUARDADO)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("guardar-paso"));
    expect(alerta).toHaveBeenCalledWith(TITULO_REENVIO, TEXTO_REENVIO, expect.any(Array), expect.any(Object));
    expect(ordenesService.cambiarEstado).toHaveBeenCalledTimes(2);
  });

  it("CA-12: agrega un material con coma decimal y quita otro con confirmación", async () => {
    ordenesService.detalle.mockResolvedValueOnce(detalle());
    ordenesService.agregarMaterial.mockResolvedValueOnce(detalle());
    ordenesService.quitarCosto.mockResolvedValueOnce(detalle({ materiales: [] }));
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("agregar-material"));
    await fireEvent.changeText(screen.getByTestId("costo-descripcion"), "Cable 12 AWG");
    await fireEvent.changeText(screen.getByTestId("costo-cantidad"), "10");
    await fireEvent.changeText(screen.getByTestId("costo-costo_unitario"), "1,25");
    expect(screen.getByTestId("costo-subtotal").props.children).toBe("Subtotal: $12,50 (sin IVA)");
    await fireEvent.press(screen.getByTestId("guardar-costo"));
    await waitFor(() =>
      expect(ordenesService.agregarMaterial).toHaveBeenCalledWith(15, { descripcion: "Cable 12 AWG", cantidad: "10", costo_unitario: "1.25" }),
    );
    expect(await screen.findByText("Material registrado.")).toBeTruthy();

    const alerta = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, botones) => botones[1].onPress());
    await fireEvent.press(screen.getByTestId("quitar-materiales-3"));
    expect(alerta).toHaveBeenCalledWith(TITULO_QUITAR_COSTO, expect.stringMatching(/«Foco LED»/), expect.any(Array), expect.any(Object));
    await waitFor(() => expect(ordenesService.quitarCosto).toHaveBeenCalledWith("15", "materiales", 3));
    expect(await screen.findByText("Se quitó «Foco LED».")).toBeTruthy();
    expect(screen.queryByTestId("materiales-3")).toBeNull();
  });

  it("CA-12: sin permisos.registrar_costos no se agrega ni se quita", async () => {
    ordenesService.detalle.mockResolvedValueOnce(detalle({ permisos: { acciones: [], registrar_costos: false } }));
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    await screen.findByText("Sin luz en cajas");
    expect(screen.queryByTestId("agregar-material")).toBeNull();
    expect(screen.queryByTestId("quitar-materiales-3")).toBeNull();
    expect(screen.queryByTestId("pasos")).toBeNull();
  });

  it("CA-11: reasigna a otra persona con el catálogo de quien coordina; en ejecución explica que hay que pausar", async () => {
    const asignable = detalle({ estado: "programada", estado_display: "Programada", permisos: { asignar: true, acciones: ["en_ejecucion"] } });
    ordenesService.detalle.mockResolvedValueOnce(asignable);
    ordenesService.asignar.mockResolvedValueOnce({ ...asignable, tecnico: { id: 11, nombre: "Luis Mora" }, responsable: "Luis Mora" });
    mockParametros.id = "15";
    // QA-FUNC O-5 (b): quien coordina sin `ordenes.crear`.
    mockSesion.usuario.permissions = ["ordenes.ver", "ordenes.gestionar"];
    const { unmount } = await render(<PantallaFicha />);
    expect(await screen.findByText("Iniciar ejecución")).toBeTruthy();
    // Abrir y cerrar la ventana no vuelve a pedir los catálogos (QA-TECH).
    await fireEvent.press(screen.getByTestId("asignar"));
    await fireEvent.press(await screen.findByTestId("cancelar-asignacion"));
    await fireEvent.press(screen.getByTestId("asignar"));
    await fireEvent.press(await screen.findByTestId("asignar-tecnico"));
    await fireEvent.press(screen.getByTestId("asignar-tecnico-opcion-11"));
    await fireEvent.changeText(screen.getByTestId("asignar-nota"), "Jorge de vacaciones");
    await fireEvent.press(screen.getByTestId("guardar-asignacion"));
    await waitFor(() => expect(ordenesService.asignar).toHaveBeenCalledWith(15, { tecnico: 11, nota: "Jorge de vacaciones" }));
    expect(await screen.findByText("Orden reasignada.")).toBeTruthy();
    expect(screen.getByLabelText("Responsable: Luis Mora")).toBeTruthy();
    expect(ordenesService.catalogos).toHaveBeenCalledTimes(1);
    expect(ordenesService.responsables).not.toHaveBeenCalled();
    await unmount();

    ordenesService.detalle.mockResolvedValueOnce(detalle({ permisos: { asignar: true, acciones: ["pausada"] } }));
    await render(<PantallaFicha />);
    expect(await screen.findByTestId("reasignar-pausada")).toBeTruthy();
    expect(screen.queryByTestId("asignar")).toBeNull();
  });

  it("UX H-07: con el número completo, «Llamar» abre el teléfono; UX H-13: sin porcentaje dice solo «IVA»", async () => {
    ordenesService.detalle.mockResolvedValueOnce(
      detalle({ contacto: "099 123 4567", costos: { subtotal: "7.00", iva: "1.05", total: "8.05" } }),
    );
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    expect((await screen.findByTestId("contacto")).props.accessibilityLabel).toBe("Teléfono de contacto: 099 123 4567");
    expect(screen.getByLabelText("IVA: $1,05")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("llamar"));
    expect(Linking.openURL).toHaveBeenCalledWith("tel:0991234567");
  });

  it("QA-FUNC O-1: si el servidor rechaza el paso por el estado, se cierra la ventana, dice el motivo y la ficha se pone al día", async () => {
    ordenesService.detalle
      .mockResolvedValueOnce(detalle())
      .mockResolvedValueOnce(detalle({ estado: "pausada", estado_display: "Pausada", permisos: { acciones: ["en_ejecucion"] } }));
    ordenesService.cambiarEstado.mockRejectedValueOnce(
      error(400, "validation_error", "Error en la solicitud.", { estado: ["Una orden pausada no puede pasar a pendiente de aprobación."] }),
    );
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("paso-pendiente_aprobacion"));
    await fireEvent.press(screen.getByTestId("guardar-paso"));
    expect(await screen.findByText("Una orden pausada no puede pasar a pendiente de aprobación.")).toBeTruthy();
    expect(screen.queryByTestId("ventana-paso")).toBeNull();
    await waitFor(() => expect(ordenesService.detalle).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Reanudar")).toBeTruthy();
  });

  it("QA-FUNC O-1: un 403 al agregar un costo también cierra la ventana y recarga", async () => {
    ordenesService.detalle.mockResolvedValue(detalle());
    ordenesService.agregarManoDeObra.mockRejectedValueOnce(
      error(403, "permission_denied", "Materiales y horas los registra el técnico asignado, o quien coordina."),
    );
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("agregar-mano-de-obra"));
    await fireEvent.changeText(screen.getByTestId("costo-descripcion"), "Cableado");
    await fireEvent.changeText(screen.getByTestId("costo-horas"), "2");
    await fireEvent.changeText(screen.getByTestId("costo-costo_hora"), "8");
    await fireEvent.press(screen.getByTestId("guardar-costo"));
    expect(await screen.findByText("Materiales y horas los registra el técnico asignado, o quien coordina.")).toBeTruthy();
    expect(screen.queryByTestId("ventana-costo")).toBeNull();
    await waitFor(() => expect(ordenesService.detalle).toHaveBeenCalledTimes(2));
  });

  it("QA-TECH: horas con más de 4 dígitos enteros no se envían; UX H-12: en iOS se anuncia el subtotal", async () => {
    ordenesService.detalle.mockResolvedValueOnce(detalle());
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("agregar-mano-de-obra"));
    await fireEvent.changeText(screen.getByTestId("costo-descripcion"), "Cableado");
    await fireEvent.changeText(screen.getByTestId("costo-horas"), "12345");
    await fireEvent.changeText(screen.getByTestId("costo-costo_hora"), "1");
    await waitFor(
      () => expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Subtotal: $12.345,00 (sin IVA)"),
      { timeout: 3000 },
    );
    await fireEvent.press(screen.getByTestId("guardar-costo"));
    expect(await screen.findByText("Revise el campo: Horas.")).toBeTruthy();
    expect(screen.getByTestId("costo-horas").props.accessibilityLabel).toMatch(/como mucho 4 dígitos antes de la coma/);
    expect(ordenesService.agregarManoDeObra).not.toHaveBeenCalled();
  });

  it("QA-FUNC O-5 (c): «Devolver a ejecución» sin nota no se envía", async () => {
    ordenesService.detalle.mockResolvedValueOnce(
      detalle({ estado: "pendiente_aprobacion", estado_display: "Pendiente de aprobación", permisos: { acciones: ["en_ejecucion", "cerrada"] } }),
    );
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("paso-en_ejecucion"));
    await fireEvent.press(screen.getByTestId("guardar-paso"));
    expect(await screen.findByText("Revise el campo: Motivo.")).toBeTruthy();
    expect(screen.getByTestId("paso-nota").props.accessibilityLabel).toMatch(/^Motivo \(obligatorio\)/);
    expect(ordenesService.cambiarEstado).not.toHaveBeenCalled();
  });

  it("QA-FUNC O-5 (a): una orden de otra empresa se ve, pero sin acciones", async () => {
    ordenesService.detalle.mockResolvedValueOnce(
      detalle({ permisos: { editar: true, asignar: true, registrar_costos: true, acciones: ["pausada"] }, estado: "pausada" }),
    );
    mockParametros.id = "15";
    mockParametros.empresa = "7";
    await render(<PantallaFicha />);
    expect(await screen.findByText(/Esta orden es de otra empresa/)).toBeTruthy();
    expect(ordenesService.detalle).toHaveBeenCalledWith("15", { empresa: "7" });
    for (const id of ["pasos", "asignar", "corregir", "agregar-material", "quitar-materiales-3"]) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(ordenesService.catalogos).not.toHaveBeenCalled();
  });

  it("QA-FUNC O-2: pendiente de aprobación explica que hay que devolverla y pausarla para reasignarla", async () => {
    ordenesService.detalle.mockResolvedValueOnce(
      detalle({ estado: "pendiente_aprobacion", permisos: { asignar: true, acciones: [] } }),
    );
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    expect((await screen.findByTestId("reasignar-pausada")).props.children).toMatch(
      /quien acepta el trabajo debe devolverla a ejecución y luego pausarla/,
    );
  });

  it("QA-FUNC O-4: si los catálogos no cargan, «Asignar» dice el motivo y se reintenta", async () => {
    ordenesService.detalle.mockResolvedValueOnce(detalle({ estado: "programada", permisos: { asignar: true, acciones: [] } }));
    ordenesService.catalogos.mockReset();
    ordenesService.catalogos.mockRejectedValueOnce(error(403, "modulo_apagado", "Apagado.")).mockResolvedValueOnce(CATALOGOS);
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("asignar"));
    expect(await screen.findByText(TEXTO_MODULO_APAGADO)).toBeTruthy();
    await fireEvent.press(screen.getByText("Reintentar"));
    expect(await screen.findByTestId("asignar-tecnico")).toBeTruthy();
  });

  it("prueba en el teléfono: sin filas los costos dicen «$0,00»; cerrada, una sola píldora «Cerrada»", async () => {
    ordenesService.detalle.mockResolvedValueOnce(
      detalle({
        estado: "cerrada",
        estado_display: "Cerrada",
        cumplimiento: "cerrada",
        fecha_cierre: "2026-11-17T16:00:00Z",
        materiales: [],
        costos: { materiales: "0.00", mano_de_obra: "0.00", subtotal: "0.00", iva_porcentaje: 15, iva: "0.00", total: "0.00" },
        permisos: { acciones: [], registrar_costos: false },
      }),
    );
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    const pildoras = await screen.findByTestId("pildoras-de-la-orden");
    expect(within(pildoras).getAllByText("Cerrada")).toHaveLength(1);
    expect(pildoras.props.accessibilityLabel).toBe("Prioridad: Alta. Estado: Cerrada");
    expect(screen.getByLabelText("Subtotal: $0,00")).toBeTruthy();
    expect(screen.getByLabelText("IVA (15 %): $0,00")).toBeTruthy();
    expect(screen.getByLabelText("Total: $0,00")).toBeTruthy();
  });

  it("CA-11: sin cambios no envía y lo dice", async () => {
    ordenesService.detalle.mockResolvedValueOnce(detalle({ estado: "programada", permisos: { asignar: true, acciones: [] } }));
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("asignar"));
    await fireEvent.press(await screen.findByTestId("guardar-asignacion"));
    expect(await screen.findByText("No cambió nada: elija otro técnico, otro proveedor u otra fecha.")).toBeTruthy();
    expect(ordenesService.asignar).not.toHaveBeenCalled();
  });

  it("CA-13: «Corregir» con permisos.editar envía solo lo que cambió", async () => {
    ordenesService.detalle.mockResolvedValueOnce(detalle({ permisos: { editar: true, acciones: [] }, telefono_contacto_editable: "0991234123" }));
    ordenesService.corregir.mockResolvedValueOnce(detalle({ titulo: "Sin luz en caja 2" }));
    mockParametros.id = "15";
    await render(<PantallaFicha />);
    await fireEvent.press(await screen.findByTestId("corregir"));
    await fireEvent.changeText(await screen.findByTestId("corregir-titulo"), "Sin luz en caja 2");
    await fireEvent.press(screen.getByTestId("corregir-prioridad-critica"));
    await fireEvent.changeText(screen.getByTestId("corregir-telefono"), "12");
    await fireEvent.press(screen.getByTestId("guardar-correccion"));
    expect(await screen.findByText("Revise el campo: Teléfono de contacto.")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("corregir-telefono"), "0991234123");
    await fireEvent.press(screen.getByTestId("guardar-correccion"));
    await waitFor(() =>
      expect(ordenesService.corregir).toHaveBeenCalledWith(15, { titulo: "Sin luz en caja 2", prioridad: "critica" }),
    );
    expect(await screen.findByText("Datos corregidos.")).toBeTruthy();
  });

  it("una orden que no existe o ya no se ve; un ID que no es número no se pide", async () => {
    ordenesService.detalle.mockRejectedValueOnce(error(404, "not_found", "No encontrado."));
    mockParametros.id = "99";
    const { unmount } = await render(<PantallaFicha />);
    expect(await screen.findByText(TEXTO_NO_DISPONIBLE)).toBeTruthy();
    await unmount();
    mockParametros.id = "abc";
    await render(<PantallaFicha />);
    expect(screen.getByText(TEXTO_NO_DISPONIBLE)).toBeTruthy();
    expect(ordenesService.detalle).toHaveBeenCalledTimes(1);
  });
});

describe("Nueva orden (CA-14 a CA-16)", () => {
  async function elegirFecha(fecha) {
    await fireEvent.press(screen.getByTestId("orden-fecha"));
    await act(async () => {
      screen.getByTestId("selector-nativo").props.onValueChange(null, fecha);
    });
  }

  it("sin ordenes.crear no hay formulario", async () => {
    await render(<PantallaNueva />);
    expect(screen.getByText(TEXTO_SIN_PERMISO_CREAR)).toBeTruthy();
    expect(ordenesService.catalogos).not.toHaveBeenCalled();
  });

  it("vacía no se envía: cada error junto a su campo", async () => {
    mockSesion.usuario.permissions = ["ordenes.ver", "ordenes.crear"];
    await render(<PantallaNueva />);
    await fireEvent.press(await screen.findByTestId("guardar-orden"));
    expect(await screen.findByText(/^Revise los campos: Sede, Categoría, Qué hay que hacer, Quién la realiza y Fecha programada\.$/)).toBeTruthy();
    expect(screen.getByTestId("orden-responsable").props.accessibilityLabel).toMatch(`Error: ${TEXTO_SIN_RESPONSABLE}`);
    expect(ordenesService.crear).not.toHaveBeenCalled();
    // UX H-11: la prioridad se marca obligatoria; UX H-10: sin botón repetido.
    expect(screen.getByLabelText("Prioridad (obligatorio)")).toBeTruthy();
    expect(screen.queryByTestId("registrar-proveedor")).toBeNull();
  });

  it("registra con una persona y el proveedor propuesto, y abre la ficha nueva anunciando su número", async () => {
    mockSesion.usuario.permissions = ["ordenes.ver", "ordenes.crear"];
    ordenesService.responsables.mockResolvedValue({
      proveedores: [{ id: 4, nombre: "Climas del Sur" }],
      personas: [{ id: 10, nombre: "Jorge Andrade", proveedor: { id: 4, nombre: "Climas del Sur" } }],
    });
    ordenesService.crear.mockResolvedValueOnce(detalle({ id: 31, numero: "OT-2026-000031" }));
    await render(<PantallaNueva />);
    await fireEvent.press(await screen.findByTestId("orden-sede"));
    await fireEvent.press(screen.getByTestId("orden-sede-opcion-3"));
    await fireEvent.press(screen.getByTestId("orden-categoria"));
    await fireEvent.press(screen.getByTestId("orden-categoria-opcion-climatizacion"));
    await fireEvent.press(screen.getByTestId("orden-prioridad-alta"));
    await fireEvent.changeText(screen.getByTestId("orden-titulo"), " Aire acondicionado no enfría ");
    await fireEvent.changeText(screen.getByTestId("orden-telefono"), "0991234567");
    const foco = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
    await fireEvent.changeText(screen.getByTestId("orden-responsable"), "jor");
    const opcion = await screen.findByTestId("orden-responsable-persona-10", {}, { timeout: 3000 });
    // UX H-14 y H-12: cada opción dice si está deshabilitada; en iOS se
    // anuncia cuántos resultados hay.
    expect(opcion.props.accessibilityState).toEqual({ disabled: false });
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("2 resultados.");
    await fireEvent.press(opcion);
    // UX H-03: el foco del lector va a la tarjeta de lo elegido.
    await waitFor(() => expect(foco).toHaveBeenCalledWith(expect.anything(), "focus"), { timeout: 3000 });
    expect(ordenesService.responsables).toHaveBeenLastCalledWith("jor", { soloProveedores: false });
    expect(screen.getByTestId("orden-proveedor-elegido")).toBeTruthy();
    expect(screen.getByLabelText(/^Proveedor: Climas del Sur\. Proveedor\. Propuesto: Climas del Sur \(último proveedor de Jorge Andrade\)/)).toBeTruthy();
    await elegirFecha(new Date(2099, 0, 15));
    expect(mockPrevenir.activa).toBe(true);

    await fireEvent.press(screen.getByTestId("guardar-orden"));
    await waitFor(() =>
      expect(ordenesService.crear).toHaveBeenCalledWith({
        sede: 3,
        categoria: "climatizacion",
        prioridad: "alta",
        titulo: "Aire acondicionado no enfría",
        descripcion: "",
        telefono_contacto: "0991234567",
        fecha_programada: "2099-01-15",
        tecnico: 10,
        proveedor: 4,
      }),
    );
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/ordenes/[id]", params: { id: "31" } }));

    // La ficha nueva anuncia el número (lo deja el alta, una sola vez).
    ordenesService.detalle.mockResolvedValueOnce(detalle({ id: 31, numero: "OT-2026-000031" }));
    mockParametros.id = "31";
    await render(<PantallaFicha />);
    expect(await screen.findByText("Orden OT-2026-000031 registrada.")).toBeTruthy();
  });

  it("CA-15: registra un proveedor nuevo con lo escrito y queda elegido; los 400 del alta van a «Quién la realiza»", async () => {
    mockSesion.usuario.permissions = ["ordenes.ver", "ordenes.crear"];
    ordenesService.registrarProveedor
      .mockRejectedValueOnce(
        error(400, "validation_error", "Error en la solicitud.", {
          nombre: ["Ya existe un proveedor llamado «ELECTRO ANDES», pero está desactivado: pida que lo reactiven."],
        }),
      )
      .mockResolvedValueOnce({ id: 40, nombre: "Electro Andes" });
    ordenesService.crear.mockRejectedValueOnce(
      error(400, "validation_error", "Error en la solicitud.", { proveedor: ["Ese proveedor está desactivado: elija otro."] }),
    );
    await render(<PantallaNueva />);
    await fireEvent.changeText(await screen.findByTestId("orden-responsable"), "Electro Andes");
    await fireEvent.press(await screen.findByTestId("orden-responsable-registrar"));
    expect(screen.getByTestId("proveedor-nombre").props.value).toBe("Electro Andes");
    await fireEvent.press(screen.getByTestId("guardar-proveedor"));
    // Sin teléfono ni correo: ni siquiera se envía.
    expect(await screen.findByText("Revise el campo: Contacto.")).toBeTruthy();
    expect(ordenesService.registrarProveedor).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId("proveedor-correo"), "ventas@electroandes.ec");
    await fireEvent.press(screen.getByTestId("guardar-proveedor"));
    // El 400 del servidor, junto a su campo.
    expect(await screen.findByText("Revise el campo: Nombre o razón social.")).toBeTruthy();
    expect(screen.getByTestId("proveedor-nombre").props.accessibilityLabel).toMatch(/Error: Ya existe un proveedor llamado «ELECTRO ANDES»/);
    await fireEvent.press(screen.getByTestId("guardar-proveedor"));
    await waitFor(() => expect(ordenesService.registrarProveedor).toHaveBeenCalledTimes(2));
    expect(ordenesService.registrarProveedor).toHaveBeenLastCalledWith({
      nombre: "Electro Andes",
      contacto: "",
      telefono: "",
      correo: "ventas@electroandes.ec",
      identificacion: "",
    });
    expect(await screen.findByTestId("orden-responsable-elegido")).toBeTruthy();
    // UX H-02: es un resultado, y se anuncia.
    expect(screen.getByText("Proveedor Electro Andes registrado y elegido.")).toBeTruthy();
    expect(screen.getByTestId("aviso-responsable").props.accessibilityRole).toBe("alert");
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Proveedor Electro Andes registrado y elegido.");

    await fireEvent.press(screen.getByTestId("orden-sede"));
    await fireEvent.press(screen.getByTestId("orden-sede-opcion-5"));
    await fireEvent.press(screen.getByTestId("orden-categoria"));
    await fireEvent.press(screen.getByTestId("orden-categoria-opcion-electrico"));
    await fireEvent.changeText(screen.getByTestId("orden-titulo"), "Tablero quemado");
    await elegirFecha(new Date(2099, 0, 15));
    await fireEvent.press(screen.getByTestId("guardar-orden"));
    await waitFor(() => expect(ordenesService.crear).toHaveBeenCalledWith(expect.objectContaining({ tecnico: null, proveedor: 40 })));
    expect(await screen.findByText("Revise el campo: Quién la realiza.")).toBeTruthy();
    expect(screen.getByLabelText(/^Quién la realiza: Electro Andes\. Proveedor\. .*Error: Ese proveedor está desactivado: elija otro\.$/)).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("QA-FUNC O-5 (d): un POST con 403 modulo_apagado dice que el módulo está apagado", async () => {
    mockSesion.usuario.permissions = ["ordenes.ver", "ordenes.crear"];
    ordenesService.responsables.mockResolvedValue({ proveedores: [{ id: 4, nombre: "Climas del Sur" }], personas: [] });
    ordenesService.crear.mockRejectedValueOnce(error(403, "modulo_apagado", "Módulo apagado."));
    await render(<PantallaNueva />);
    await fireEvent.press(await screen.findByTestId("orden-sede"));
    await fireEvent.press(screen.getByTestId("orden-sede-opcion-3"));
    await fireEvent.press(screen.getByTestId("orden-categoria"));
    await fireEvent.press(screen.getByTestId("orden-categoria-opcion-electrico"));
    await fireEvent.changeText(screen.getByTestId("orden-titulo"), "Luz");
    await fireEvent(screen.getByTestId("orden-responsable"), "focus");
    await fireEvent.press(await screen.findByTestId("orden-responsable-proveedor-4"));
    await elegirFecha(new Date(2099, 0, 15));
    await fireEvent.press(screen.getByTestId("guardar-orden"));
    expect(await screen.findByText(TEXTO_MODULO_APAGADO)).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("UX H-03: al quitar lo elegido, el foco vuelve al campo de búsqueda", async () => {
    mockSesion.usuario.permissions = ["ordenes.ver", "ordenes.crear"];
    ordenesService.responsables.mockResolvedValue({ proveedores: [{ id: 4, nombre: "Climas del Sur" }], personas: [] });
    const foco = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
    await render(<PantallaNueva />);
    await fireEvent(await screen.findByTestId("orden-responsable"), "focus");
    await fireEvent.press(await screen.findByTestId("orden-responsable-proveedor-4"));
    await waitFor(() => expect(foco).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await fireEvent.press(screen.getByTestId("orden-responsable-quitar"));
    const campo = await screen.findByTestId("orden-responsable");
    await waitFor(() => expect(foco).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(foco.mock.calls[1][1]).toBe("focus");
    expect(campo).toBeTruthy();
  });

  it("CA-16: un doble toque hace una sola petición", async () => {
    mockSesion.usuario.permissions = ["ordenes.ver", "ordenes.crear"];
    ordenesService.responsables.mockResolvedValue({ proveedores: [{ id: 4, nombre: "Climas del Sur" }], personas: [] });
    let resolver;
    ordenesService.crear.mockImplementationOnce(() => new Promise((r) => (resolver = r)));
    await render(<PantallaNueva />);
    await fireEvent.press(await screen.findByTestId("orden-sede"));
    await fireEvent.press(screen.getByTestId("orden-sede-opcion-3"));
    await fireEvent.press(screen.getByTestId("orden-categoria"));
    await fireEvent.press(screen.getByTestId("orden-categoria-opcion-electrico"));
    await fireEvent.changeText(screen.getByTestId("orden-titulo"), "Luz");
    await fireEvent(screen.getByTestId("orden-responsable"), "focus");
    await fireEvent.press(await screen.findByTestId("orden-responsable-proveedor-4"));
    await elegirFecha(new Date(2099, 0, 15));
    await fireEvent.press(screen.getByTestId("guardar-orden"));
    await fireEvent.press(screen.getByTestId("guardar-orden"));
    expect(ordenesService.crear).toHaveBeenCalledTimes(1);
    expect(ordenesService.responsables).toHaveBeenCalledWith("", { soloProveedores: false });
    await act(async () => resolver(detalle({ id: 32, numero: "OT-2026-000032" })));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledTimes(1));
  });
});

describe("US-026: modo oscuro", () => {
  afterEach(olvidarApariencia);

  it("el panel de Órdenes de trabajo en oscuro (CA-5)", async () => {
    mockParametros.vista = "panel";
    ordenesService.resumen.mockResolvedValueOnce(RESUMEN);
    const vista = await renderEnOscuro(<OrdenesDeTrabajo />);
    expect(await screen.findByText(`Alcance: ${RESUMEN.alcance}`)).toBeTruthy();
    expect(coloresClarosEn(vista.toJSON())).toEqual([]);
  });
});
