import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import { AccessibilityInfo, Alert, AppState, Platform, StyleSheet } from "react-native";

import { soporteService } from "../src/api/servicios";
import { dejarAviso } from "../src/soporte/avisoPendiente";
import { TEXTO_MODULO_APAGADO } from "../src/soporte/formato";
import { SONDEO_LISTAS_MS } from "../src/soporte/useSondeo";
import { TEXTO_FALTAN_OTRAS, TEXTO_NOTA_OBLIGATORIA } from "../src/pantallas/soporte/Aprobaciones";
import {
  ESPERA_BUSCAR_MS,
  TEXTO_COLA_VACIA,
  TEXTO_SOLO_REGISTRA,
  unirSinRepetir,
} from "../src/pantallas/soporte/Bandeja";
import { colores } from "../src/tema/colores";
import { MesaDeAyuda } from "../src/pantallas/soporte/MesaDeAyuda";
import { textoPendientes } from "../src/pantallas/soporte/MisTickets";
import { TEXTO_SIN_PERMISO_PARA_CREAR } from "../src/pantallas/soporte/NuevoTicket";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockParametros = {};
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    useNavigation: () => ({ setOptions: jest.fn(), dispatch: jest.fn() }),
    usePreventRemove: () => {},
    useLocalSearchParams: () => mockParametros,
    useFocusEffect: (efecto) => React.useEffect(efecto, [efecto]),
  };
});

const mockSesion = { usuario: { permissions: [] }, empresaActiva: { id: 1 }, versionEmpresa: 0 };
jest.mock("../src/sesion/SesionContext", () => ({ useSesion: () => mockSesion }));

const mockResumen = {
  delEquipo: false,
  noEsDelEquipo: false,
  aprobaciones: 0,
  misPendientes: 0,
  asignados: 0,
  recargar: jest.fn(async () => {}),
  informarMisTickets: jest.fn(),
  marcarNoEsDelEquipo: jest.fn(),
};

function mockMarcarNoEsDelEquipo() {
  mockResumen.noEsDelEquipo = true;
  mockOyentes.forEach((repintar) => repintar((n) => n + 1));
}
/** Quien lee el resumen se vuelve a pintar cuando `marcarNoEsDelEquipo`
 * lo cambia, como con el proveedor de verdad. */
const mockOyentes = new Set();
jest.mock("../src/soporte/ResumenSoporteContext", () => {
  const React = require("react");
  return {
    useResumenSoporte: () => {
      const [, repintar] = React.useState(0);
      React.useEffect(() => {
        mockOyentes.add(repintar);
        return () => mockOyentes.delete(repintar);
      }, []);
      return mockResumen;
    },
    useRecargarResumenSoporte: () => mockResumen,
  };
});

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});

jest.mock("../src/api/servicios", () => ({
  soporteService: {
    misTickets: jest.fn(),
    bandeja: jest.fn(),
    tickets: jest.fn(),
    etiquetas: jest.fn(async () => ({ estados: [["nuevo", "En cola"], ["en_curso", "En curso"]], prioridades: [["alta", "P2 · Alta"], ["baja", "P4 · Baja"]] })),
    tomarSiguiente: jest.fn(),
    aprobaciones: jest.fn(),
    decidirAprobacion: jest.fn(),
  },
}));

function error(status, code, message = "Error") {
  const e = new Error(message);
  e.response = { status, data: { error: { code, message, details: null } } };
  return e;
}

/** Con la forma de `MisTicketsView`. */
function miTicket(campos = {}) {
  return {
    id: 1,
    numero: "TCK-2026-1",
    categoria: "Impresoras",
    caso: "Papel atascado",
    estado: "nuevo",
    estado_display: "En cola",
    atrasado: false,
    puede_encuestar: false,
    prioridad: "media",
    prioridad_display: "P3 · Media",
    posicion: 2,
    actualizado: "2026-11-13T10:00:00Z",
    creado: "2026-11-13T09:00:00Z",
    atendido_en: null,
    ...campos,
  };
}

/** Con la forma de `TicketListaSerializer`. */
function ticket(campos = {}) {
  return {
    id: 10,
    numero: "TCK-2026-10",
    estado: "asignado",
    estado_display: "Asignado",
    prioridad: "alta",
    prioridad_display: "P2 · Alta",
    categoria: "Correo",
    caso: "No envía",
    agencia: "Matriz",
    area: "Cartera",
    tecnico: { id: 3, nombre: "Luis Mora" },
    solicitante_nombre: "Ana Pérez",
    posicion: null,
    escalado_por_sla: false,
    sla: { estado: "en_plazo", vence: "2099-01-01T00:00:00Z", respuesta: { estado: "cumplida" } },
    ...campos,
  };
}

const BANDEJA = {
  tecnico: { id: 3, nivel: "N1", categorias: ["Correo"], capacidad: 5, en_horario: true, abiertos: 2, cola_para_mi: 4 },
  cola_total: 7,
  categorias_sin_tecnicos: [],
  puede: { crear: true, mesa_crear: true, ver_todos: false, asignar: false, registrar: true },
};

function pagina(results, next = null, count = results.length) {
  return { count, next, results };
}

function anunciados() {
  return AccessibilityInfo.announceForAccessibility.mock.calls.map(([t]) => t);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: jest.fn() }));
  Object.keys(mockParametros).forEach((k) => delete mockParametros[k]);
  mockSesion.usuario = { permissions: ["soporte.crear"] };
  Object.assign(mockResumen, { delEquipo: false, noEsDelEquipo: false, aprobaciones: 0, misPendientes: 0, asignados: 0 });
  mockResumen.marcarNoEsDelEquipo.mockImplementation(mockMarcarNoEsDelEquipo);
  soporteService.misTickets.mockResolvedValue([]);
  soporteService.bandeja.mockResolvedValue(BANDEJA);
  soporteService.tickets.mockResolvedValue(pagina([]));
  soporteService.aprobaciones.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("la Mesa de ayuda: vistas según permisos (CA-1)", () => {
  it("quien no es del equipo ve solo «Mis tickets», sin pestañas ni llamada a la bandeja", async () => {
    await render(<MesaDeAyuda />);
    expect(await screen.findByText("Todavía no ha pedido ayuda.")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(soporteService.bandeja).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Nuevo ticket" })).toBeTruthy();
  });

  it("sin permiso para crear, lo dice en lugar del botón", async () => {
    mockSesion.usuario = { permissions: [] };
    await render(<MesaDeAyuda />);
    expect(await screen.findByText(TEXTO_SIN_PERMISO_PARA_CREAR)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nuevo ticket" })).toBeNull();
  });

  it("el equipo entra a la bandeja; sin controles segmentados arriba (US-016, CA-3)", async () => {
    mockResumen.delEquipo = true;
    await render(<MesaDeAyuda />);
    expect(await screen.findByTestId("mesa-de-ayuda-bandeja")).toBeTruthy();
    await waitFor(() => expect(soporteService.bandeja).toHaveBeenCalled());
    expect(screen.queryByTestId("vistas-mesa")).toBeNull();
  });

  it("US-016: la vista sale de ?vista= (la barra de abajo, el Inicio o un aviso)", async () => {
    mockResumen.delEquipo = true;
    mockParametros.vista = "mis";
    await render(<MesaDeAyuda />);
    expect(await screen.findByText("Todavía no ha pedido ayuda.")).toBeTruthy();
    expect(screen.getByTestId("mesa-de-ayuda-mis")).toBeTruthy();
  });

  it("?vista=bandeja sin ser del equipo abre «Mis tickets»", async () => {
    mockParametros.vista = "bandeja";
    await render(<MesaDeAyuda />);
    expect(await screen.findByTestId("mesa-de-ayuda-mis")).toBeTruthy();
    expect(soporteService.bandeja).not.toHaveBeenCalled();
  });

  it("G-9: cuando el resumen vuelve a comprobarlo (otra empresa), vuelve la bandeja", async () => {
    mockResumen.delEquipo = true;
    soporteService.bandeja.mockRejectedValueOnce(error(403, "permission_denied", "No tiene permiso"));
    const { rerender } = await render(<MesaDeAyuda />);
    expect(await screen.findByTestId("mesa-de-ayuda-mis")).toBeTruthy();
    // El proveedor lo pone en falso al cambiar de empresa (soporteServicios.test.js).
    mockResumen.noEsDelEquipo = false;
    mockSesion.versionEmpresa = 1;
    await rerender(<MesaDeAyuda />);
    expect(await screen.findByTestId("mesa-de-ayuda-bandeja")).toBeTruthy();
    mockSesion.versionEmpresa = 0;
  });

  it("si la bandeja responde 403, lo informa al resumen y pasa a «Mis tickets» sin error", async () => {
    mockResumen.delEquipo = true;
    soporteService.bandeja.mockRejectedValue(error(403, "permission_denied", "No tiene permiso"));
    await render(<MesaDeAyuda />);
    expect(await screen.findByText("Todavía no ha pedido ayuda.")).toBeTruthy();
    expect(screen.getByTestId("mesa-de-ayuda-mis")).toBeTruthy();
    expect(screen.queryByText("No tiene permiso")).toBeNull();
    expect(mockResumen.marcarNoEsDelEquipo).toHaveBeenCalled();
  });

  it("con el 403 ya en el resumen, la Mesa no abre la bandeja", async () => {
    Object.assign(mockResumen, { delEquipo: true, noEsDelEquipo: true });
    await render(<MesaDeAyuda />);
    expect(await screen.findByTestId("mesa-de-ayuda-mis")).toBeTruthy();
    expect(soporteService.bandeja).not.toHaveBeenCalled();
  });

  it("un aviso puede abrir «Aprobaciones» aunque ya no quede ninguna", async () => {
    mockParametros.vista = "aprobaciones";
    await render(<MesaDeAyuda />);
    expect(await screen.findByTestId("mesa-de-ayuda-aprobaciones")).toBeTruthy();
    expect(soporteService.aprobaciones).toHaveBeenCalled();
  });

  it("CA-20: lo de escritorio se ofrece en el navegador según los permisos", async () => {
    mockSesion.usuario = { permissions: ["soporte.crear", "soporte.reportes", "soporte.configurar"] };
    await render(<MesaDeAyuda />);
    expect(await screen.findByRole("header", { name: "Más opciones en el navegador" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Mi horario/ })).toBeNull();
    await fireEvent.press(screen.getByRole("link", { name: "Reportes de la mesa. Abrir en el navegador" }));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/reportes\/soporte\?empresa=1$/));
  });

  it("CA-15: al volver de una ficha escalada, la Mesa lo dice", async () => {
    dejarAviso("Ticket TCK-2026-10 escalado; ya no está en su bandeja.");
    await render(<MesaDeAyuda />);
    expect(await screen.findByText("Ticket TCK-2026-10 escalado; ya no está en su bandeja.")).toBeTruthy();
  });

  it("CA-3: con el módulo apagado lo dice claro, con «Reintentar»", async () => {
    soporteService.misTickets.mockRejectedValue(error(403, "modulo_apagado", "El módulo «Mesa de ayuda» está apagado en la empresa."));
    await render(<MesaDeAyuda />);
    expect(await screen.findByText(TEXTO_MODULO_APAGADO)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });
});

describe("Mis tickets (CA-6)", () => {
  it("ordena lo que pide algo de la persona primero y dice qué sigue", async () => {
    soporteService.misTickets.mockResolvedValue([
      miTicket({ id: 1, numero: "TCK-1", estado: "cerrado", estado_display: "Cerrado", posicion: null }),
      miTicket({ id: 2, numero: "TCK-2" }),
      miTicket({ id: 3, numero: "TCK-3", estado: "esperando_usuario", estado_display: "Esperando su respuesta", posicion: null }),
    ]);
    await render(<MesaDeAyuda />);
    await screen.findByTestId("mi-ticket-3");
    const filas = screen.getAllByRole("button", { name: /^TCK-\d\./ }).map((b) => b.props.accessibilityLabel);
    expect(filas.map((f) => f.split(".")[0])).toEqual(["TCK-3", "TCK-2", "TCK-1"]);
    expect(filas[0]).toContain("Estado: Esperando su respuesta. Le toca a usted: Le respondieron: lea y conteste");
    expect(filas[1]).toContain("Prioridad: P3 · Media");
    expect(filas[1]).toContain("Hay 1 ticket antes que el suyo.");
    expect(screen.getByText(textoPendientes(1))).toBeTruthy();

    await fireEvent.press(screen.getByTestId("mi-ticket-3"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/soporte/mi-ticket/[id]", params: { id: "3" } });
    // T1: lo cargado alimenta «Para hoy»; el refresco no pide mis-tickets otra vez.
    expect(mockResumen.informarMisTickets).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 3 })]));
    await fireEvent.press(screen.getByRole("button", { name: "Actualizar mis tickets" }));
    expect(mockResumen.recargar).toHaveBeenLastCalledWith({ sinMisTickets: true });
  });

  it("se refresca cada 30 s sin borrar lo que se ve si falla", async () => {
    jest.useFakeTimers();
    soporteService.misTickets.mockResolvedValue([miTicket()]);
    await render(<MesaDeAyuda />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("mi-ticket-1")).toBeTruthy();
    soporteService.misTickets.mockRejectedValueOnce(Object.assign(new Error("red"), { esDeRed: true }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SONDEO_LISTAS_MS);
    });
    expect(soporteService.misTickets).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("mi-ticket-1")).toBeTruthy();
    expect(screen.getByText(/Se muestran los anteriores/)).toBeTruthy();
  });
});

describe("la bandeja del equipo (CA-8 y CA-9)", () => {
  beforeEach(() => {
    mockResumen.delEquipo = true;
  });

  it("muestra la cabecera del técnico y cada fila con su estado y plazo en texto", async () => {
    soporteService.tickets.mockResolvedValue(
      pagina([ticket(), ticket({ id: 11, numero: "TCK-2026-11", tecnico: null, posicion: 2, escalado_por_sla: true, estado: "nuevo", estado_display: "En cola" })]),
    );
    await render(<MesaDeAyuda />);
    expect(await screen.findByText("En horario de atención")).toBeTruthy();
    expect(screen.getByTestId("cabecera-tecnico")).toBeTruthy();
    expect(screen.getByText(/de 5 en atención/)).toBeTruthy();
    expect(screen.getByText(/en la cola para usted/)).toBeTruthy();
    expect(soporteService.tickets).toHaveBeenCalledWith(expect.objectContaining({ ambito: "mios", page: 1 }));
    const fila = screen.getByTestId("ticket-11").props.accessibilityLabel;
    expect(fila).toContain("Ana Pérez, Matriz");
    expect(fila).toContain("Estado: En cola, escalado por SLA");
    expect(fila).toContain("Puesto 2 en la cola");
    expect(fila).toMatch(/Plazo: Solucionar en/);
    expect(screen.getByText("2 tickets. Primero lo que vence antes.")).toBeTruthy();
  });

  it("las vistas: «Cola» sin filtro de estado; «Todos» solo con ver_todos o asignar", async () => {
    await render(<MesaDeAyuda />);
    await screen.findByTestId("cabecera-tecnico");
    expect(screen.queryByRole("tab", { name: "Todos" })).toBeNull();
    expect(screen.getByTestId("filtro-estado")).toBeTruthy();
    await fireEvent.press(screen.getByRole("tab", { name: "Cola" }));
    await waitFor(() => expect(soporteService.tickets).toHaveBeenLastCalledWith(expect.objectContaining({ ambito: "cola" })));
    expect(screen.queryByTestId("filtro-estado")).toBeNull();
  });

  it("con asignar aparece «Todos»", async () => {
    soporteService.bandeja.mockResolvedValue({ ...BANDEJA, tecnico: null, puede: { ...BANDEJA.puede, asignar: true } });
    await render(<MesaDeAyuda />);
    await waitFor(() => expect(soporteService.tickets).toHaveBeenCalledWith(expect.objectContaining({ ambito: "todos" })));
    expect(screen.queryByRole("button", { name: /^Tomar siguiente/ })).toBeNull();
  });

  it("busca con una pausa de 300 ms, filtra por estado, prioridad y vencidos, y anuncia cuántos hay", async () => {
    await render(<MesaDeAyuda />);
    await screen.findByTestId("cabecera-tecnico");
    jest.useFakeTimers();
    soporteService.tickets.mockResolvedValue(pagina([ticket()]));
    await fireEvent.changeText(screen.getByTestId("buscar-tickets"), "ana");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ESPERA_BUSCAR_MS - 50);
    });
    expect(soporteService.tickets).not.toHaveBeenCalledWith(expect.objectContaining({ q: "ana" }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60);
    });
    expect(soporteService.tickets).toHaveBeenLastCalledWith(expect.objectContaining({ q: "ana", page: 1 }));
    expect(anunciados()).toContain("1 ticket con «ana».");
    jest.useRealTimers();

    await fireEvent.press(screen.getByTestId("filtro-estado"));
    await fireEvent.press(screen.getByTestId("filtro-estado-opcion-en_curso"));
    await waitFor(() => expect(soporteService.tickets).toHaveBeenLastCalledWith(expect.objectContaining({ estado: "en_curso" })));
    await fireEvent.press(screen.getByTestId("filtro-prioridad"));
    await fireEvent.press(screen.getByTestId("filtro-prioridad-opcion-alta"));
    await waitFor(() => expect(soporteService.tickets).toHaveBeenLastCalledWith(expect.objectContaining({ prioridad: "alta" })));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Solo vencidos" }));
    await waitFor(() => expect(soporteService.tickets).toHaveBeenLastCalledWith(expect.objectContaining({ vencidos: "true" })));
  });

  it("pagina de a 20 al llegar al final y no repite tickets", async () => {
    const primera = Array.from({ length: 20 }, (_, i) => ticket({ id: 100 + i, numero: `TCK-${100 + i}` }));
    soporteService.tickets.mockResolvedValueOnce(pagina(primera, "siguiente", 25));
    soporteService.tickets.mockResolvedValueOnce(
      pagina([ticket({ id: 119, numero: "TCK-119" }), ...Array.from({ length: 5 }, (_, i) => ticket({ id: 200 + i, numero: `TCK-${200 + i}` }))], null, 25),
    );
    await render(<MesaDeAyuda />);
    await screen.findByTestId("ticket-100");
    await act(async () => {
      screen.getByTestId("lista-bandeja").props.onEndReached();
    });
    expect(soporteService.tickets).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    // La lista virtualiza: se cuentan los datos, no las filas pintadas.
    await waitFor(() => expect(screen.getByTestId("lista-bandeja").props.data).toHaveLength(25));
    expect(new Set(screen.getByTestId("lista-bandeja").props.data.map((t) => t.id)).size).toBe(25);
    expect(screen.queryByRole("button", { name: "Ver más tickets" })).toBeNull();
  });

  it("T2: cuenta las páginas pedidas: con un repetido en la 2, la siguiente es la 3", async () => {
    const pagina1 = Array.from({ length: 20 }, (_, i) => ticket({ id: 100 + i, numero: `TCK-${100 + i}` }));
    const pagina2 = [ticket({ id: 119 }), ...Array.from({ length: 19 }, (_, i) => ticket({ id: 200 + i }))];
    soporteService.tickets.mockResolvedValueOnce(pagina(pagina1, "s", 60));
    soporteService.tickets.mockResolvedValueOnce(pagina(pagina2, "s", 60));
    soporteService.tickets.mockResolvedValueOnce(pagina([ticket({ id: 300 })], null, 60));
    await render(<MesaDeAyuda />);
    await screen.findByTestId("ticket-100");
    await act(async () => screen.getByTestId("lista-bandeja").props.onEndReached());
    await waitFor(() => expect(screen.getByTestId("lista-bandeja").props.data).toHaveLength(39));
    await act(async () => screen.getByTestId("lista-bandeja").props.onEndReached());
    expect(soporteService.tickets).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
  });

  it("T2: el refresco pide hasta 100 de una vez y conserva lo cargado más allá, sin repetidos", async () => {
    jest.useFakeTimers();
    const lote = (desde, n) => Array.from({ length: n }, (_, i) => ticket({ id: desde + i, numero: `T-${desde + i}` }));
    soporteService.tickets.mockResolvedValueOnce(pagina(lote(1, 20), "s", 140));
    for (let p = 2; p <= 6; p += 1) soporteService.tickets.mockResolvedValueOnce(pagina(lote((p - 1) * 20 + 1, 20), "s", 140));
    await render(<MesaDeAyuda />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    for (let p = 2; p <= 6; p += 1) {
      await act(async () => {
        await screen.getByTestId("lista-bandeja").props.onEndReached();
      });
    }
    expect(screen.getByTestId("lista-bandeja").props.data).toHaveLength(120);
    // El refresco trae los primeros 100 (con uno nuevo arriba).
    soporteService.tickets.mockResolvedValueOnce(pagina([ticket({ id: 999 }), ...lote(1, 99)], "s", 141));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SONDEO_LISTAS_MS);
    });
    expect(soporteService.tickets).toHaveBeenCalledWith(expect.objectContaining({ page: 1, page_size: 100 }));
    const ids = screen.getByTestId("lista-bandeja").props.data.map((t) => t.id);
    expect(ids[0]).toBe(999);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(120);
  });

  it("T2 y G-10: si la página pedida ya no existe (404), se recarga desde el principio", async () => {
    soporteService.tickets.mockResolvedValueOnce(pagina([ticket({ id: 1 })], "s", 30));
    soporteService.tickets.mockRejectedValueOnce(error(404, "not_found", "Página no válida."));
    soporteService.tickets.mockResolvedValueOnce(pagina([ticket({ id: 2 })], null, 1));
    await render(<MesaDeAyuda />);
    await screen.findByTestId("ticket-1");
    await act(async () => screen.getByTestId("lista-bandeja").props.onEndReached());
    expect(await screen.findByTestId("ticket-2")).toBeTruthy();
    expect(soporteService.tickets).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));
    expect(screen.queryByText("Página no válida.")).toBeNull();
  });

  it("H-03 y H-16: «Limpiar» aparece con filtros; en iOS se anuncia el total al filtrar", async () => {
    await render(<MesaDeAyuda />);
    await screen.findByTestId("cabecera-tecnico");
    expect(screen.queryByRole("button", { name: "Limpiar los filtros" })).toBeNull();
    expect(screen.getByRole("button", { name: "Estado: Abiertos" })).toBeTruthy();
    soporteService.tickets.mockResolvedValue(pagina([ticket()]));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Solo vencidos" }));
    await waitFor(() => expect(anunciados()).toContain("1 ticket."));
    await fireEvent.press(screen.getByRole("button", { name: "Limpiar los filtros" }));
    await waitFor(() => expect(soporteService.tickets).toHaveBeenLastCalledWith(expect.objectContaining({ vencidos: undefined })));
    expect(screen.queryByRole("button", { name: "Limpiar los filtros" })).toBeNull();
  });

  it("H-21: quien solo registra tickets lo lee así", async () => {
    soporteService.bandeja.mockResolvedValue({ ...BANDEJA, tecnico: null, puede: { registrar: true } });
    await render(<MesaDeAyuda />);
    expect(await screen.findByText(TEXTO_SOLO_REGISTRA)).toBeTruthy();
  });

  it("«Tomar siguiente» abre la ficha; con la cola vacía (404) lo dice", async () => {
    soporteService.tomarSiguiente.mockResolvedValueOnce({ id: 55, numero: "TCK-2026-55" });
    await render(<MesaDeAyuda />);
    await screen.findByTestId("cabecera-tecnico");
    await fireEvent.press(screen.getByRole("button", { name: "Tomar siguiente" }));
    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/soporte/ticket/[id]", params: { id: "55" } }),
    );

    soporteService.tomarSiguiente.mockRejectedValueOnce(error(404, "not_found", "No hay tickets en la cola que usted pueda atender."));
    await fireEvent.press(screen.getByRole("button", { name: "Tomar siguiente" }));
    expect(await screen.findByText(TEXTO_COLA_VACIA)).toBeTruthy();
  });

  it("sin nada en su cola, «Tomar siguiente» está desactivado con la explicación", async () => {
    soporteService.bandeja.mockResolvedValue({ ...BANDEJA, tecnico: { ...BANDEJA.tecnico, cola_para_mi: 0 } });
    await render(<MesaDeAyuda />);
    const boton = await screen.findByRole("button", { name: "Tomar siguiente" });
    expect(boton.props.accessibilityState.disabled).toBe(true);
    expect(screen.getAllByText(/No hay tickets de sus categorías en la cola/).length).toBeGreaterThan(0);
  });

  it("«Registrar» lleva al alta interna; su nombre accesible contiene lo visible (H-03)", async () => {
    await render(<MesaDeAyuda />);
    const boton = await screen.findByRole("button", { name: "Registrar ticket a nombre de otra persona" });
    expect(within(boton).getByText("Registrar")).toBeTruthy();
    await fireEvent.press(boton);
    expect(mockRouter.push).toHaveBeenCalledWith("/soporte/registrar");
  });

  it("H-03/H-08: los filtros en una fila que se desplaza; el nivel en una línea, entero para el lector", async () => {
    await render(<MesaDeAyuda />);
    await screen.findByTestId("cabecera-tecnico");
    expect(screen.getByTestId("fila-filtros").props.horizontal).toBe(true);
    const nivel = screen.getByTestId("nivel-tecnico");
    expect(nivel.props.numberOfLines).toBe(1);
    expect(nivel.props.accessibilityLabel).toBe("Nivel N1. Categorías: Correo");
  });

  it("N-10: las vistas son pestañas subrayadas; un filtro activo no es negro relleno", async () => {
    await render(<MesaDeAyuda />);
    await screen.findByTestId("cabecera-tecnico");
    const vista = StyleSheet.flatten(screen.getByTestId("vista-mios").props.style);
    expect(vista.borderBottomColor).toBe(colores.primario);
    expect(vista.backgroundColor).toBeUndefined();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Solo vencidos" }));
    const filtro = StyleSheet.flatten(screen.getByTestId("filtro-vencidos").props.style);
    expect(filtro.backgroundColor).toBe(colores.realce);
  });

  it("N-06: en Android el total no se anuncia (lo dice la región viva) e incluye la búsqueda", async () => {
    const so = Platform.OS;
    Platform.OS = "android";
    try {
      await render(<MesaDeAyuda />);
      await screen.findByTestId("cabecera-tecnico");
      jest.useFakeTimers();
      soporteService.tickets.mockResolvedValue(pagina([ticket()]));
      await fireEvent.changeText(screen.getByTestId("buscar-tickets"), "ana");
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ESPERA_BUSCAR_MS + 10);
      });
      expect(screen.getByTestId("total-tickets").props.children).toMatch(/^1 ticket con «ana»\./);
      expect(screen.getByTestId("total-tickets").props.accessibilityLiveRegion).toBe("polite");
      expect(anunciados().some((t) => /ticket/.test(t))).toBe(false);
    } finally {
      Platform.OS = so;
    }
  });

  it("QA-TECH (a): con un refresco en vuelo no se piden más páginas", async () => {
    soporteService.tickets.mockResolvedValueOnce(pagina([ticket({ id: 1 })], "s", 40));
    await render(<MesaDeAyuda />);
    await screen.findByTestId("ticket-1");
    let resolver;
    soporteService.tickets.mockReturnValueOnce(new Promise((r) => (resolver = r)));
    // Sin esperar: el refresco queda en vuelo.
    let refresco;
    await act(async () => {
      refresco = screen.getByTestId("lista-bandeja").props.refreshControl.props.onRefresh();
    });
    const antes = soporteService.tickets.mock.calls.length;
    await act(async () => screen.getByTestId("lista-bandeja").props.onEndReached());
    expect(soporteService.tickets.mock.calls.length).toBe(antes);
    await act(async () => {
      resolver(pagina([ticket({ id: 1 })], "s", 40));
      await refresco;
    });
    soporteService.tickets.mockResolvedValueOnce(pagina([ticket({ id: 2 })], null, 40));
    await act(async () => screen.getByTestId("lista-bandeja").props.onEndReached());
    expect(soporteService.tickets).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  });

  it("QA-TECH (c): el error de una página pedida antes de cambiar el filtro no se muestra", async () => {
    soporteService.tickets.mockResolvedValueOnce(pagina([ticket({ id: 1 })], "s", 40));
    await render(<MesaDeAyuda />);
    await screen.findByTestId("ticket-1");
    let rechazar;
    soporteService.tickets.mockReturnValueOnce(new Promise((_, r) => (rechazar = r)));
    await act(async () => {
      screen.getByTestId("lista-bandeja").props.onEndReached();
    });
    soporteService.tickets.mockResolvedValue(pagina([ticket({ id: 5 })]));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Solo vencidos" }));
    await screen.findByTestId("ticket-5");
    await act(async () => rechazar(error(500, "error", "Falló la página 2")));
    expect(screen.queryByText("Falló la página 2")).toBeNull();
  });

  it("QA-TECH (b): el refresco no pierde el ticket de la frontera", () => {
    const previos = Array.from({ length: 120 }, (_, i) => ({ id: i + 1 }));
    // Entró uno nuevo arriba: el 100 de antes ahora es el 101 y no vino.
    const nuevos = [{ id: 999 }, ...previos.slice(0, 99)];
    const unidos = unirSinRepetir(nuevos, previos, 100);
    expect(unidos.map((t) => t.id)).toContain(100);
    expect(unidos).toHaveLength(121);
    expect(new Set(unidos.map((t) => t.id)).size).toBe(121);
  });
});

describe("Aprobaciones (CA-17)", () => {
  const APROBACION = {
    id: 3,
    rol: "Jefe de área (Cartera)",
    sin_aprobador: false,
    creada: "2026-11-13T09:00:00Z",
    ticket: {
      numero: "TCK-2026-3",
      solicitante: "Ana Pérez",
      correo: "ana@grupolaar.com",
      area: "Cartera",
      agencia: "Matriz",
      categoria: "Accesos",
      codigo: "AC-01",
      caso: "Acceso al ERP",
      prioridad_display: "P3 · Media",
      descripcion: "Necesito acceso al módulo de cobranzas",
      datos_adicionales: [],
    },
  };

  beforeEach(() => {
    mockResumen.aprobaciones = 1;
    mockParametros.vista = "aprobaciones";
    soporteService.aprobaciones.mockResolvedValue([APROBACION]);
  });

  it("muestra la solicitud y no deja «No aprobar» sin nota", async () => {
    await render(<MesaDeAyuda />);
    const tarjeta = await screen.findByTestId("aprobacion-3");
    expect(within(tarjeta).getByText("TCK-2026-3 · AC-01 · Acceso al ERP")).toBeTruthy();
    expect(within(tarjeta).getByLabelText("Pide: Ana Pérez · ana@grupolaar.com")).toBeTruthy();
    expect(within(tarjeta).getByLabelText("Área y agencia: Cartera · Matriz")).toBeTruthy();

    // H-05: la nota no está hasta tocar «No aprobar»; entonces recibe el foco.
    expect(screen.queryByTestId("nota-3")).toBeNull();
    const enfocar = jest.spyOn(require("react-native").TextInput.prototype, "focus").mockImplementation(() => {});
    await fireEvent.press(screen.getByRole("button", { name: "No aprobar" }));
    expect(screen.getByTestId("nota-3")).toBeTruthy();
    expect(enfocar).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "No aprobar" }));
    expect(soporteService.decidirAprobacion).not.toHaveBeenCalled();
    expect(screen.getByTestId("nota-3").props.accessibilityLabel).toContain(`Error: ${TEXTO_NOTA_OBLIGATORIA}`);
    expect(anunciados()).toContain(TEXTO_NOTA_OBLIGATORIA);
    enfocar.mockRestore();
  });

  it("al no aprobar advierte que cierra el ticket y envía la nota", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation((_t, mensaje, botones) => {
      expect(mensaje).toContain("El ticket se cierra");
      botones.find((b) => b.text === "No aprobar").onPress();
    });
    soporteService.decidirAprobacion.mockResolvedValue({ numero: "TCK-2026-3", estado: "cerrado" });
    await render(<MesaDeAyuda />);
    await fireEvent.press(await screen.findByRole("button", { name: "No aprobar" }));
    await fireEvent.changeText(await screen.findByTestId("nota-3"), "No corresponde a su área");
    soporteService.aprobaciones.mockResolvedValue([]);
    await fireEvent.press(screen.getByRole("button", { name: "No aprobar" }));
    expect(alerta).toHaveBeenCalled();
    expect(soporteService.decidirAprobacion).toHaveBeenCalledWith(3, false, "No corresponde a su área");
    expect(await screen.findByText("TCK-2026-3 no aprobado: se le avisó a quien lo pidió.")).toBeTruthy();
    expect(mockResumen.recargar).toHaveBeenCalled();
  });

  it("aprobar no pide nota; un fallo de red dice que pudo haberse enviado", async () => {
    soporteService.decidirAprobacion.mockRejectedValueOnce(Object.assign(new Error("red"), { esDeRed: true }));
    await render(<MesaDeAyuda />);
    await fireEvent.press(await screen.findByRole("button", { name: "Aprobar" }));
    expect(soporteService.decidirAprobacion).toHaveBeenCalledWith(3, true, "");
    expect(await screen.findByText(/puede que sí se haya enviado/)).toBeTruthy();
  });

  it("abre la vista de aprobaciones (la insignia, en singular, la prueba el catálogo: navegacion.test.js)", async () => {
    await render(<MesaDeAyuda />);
    expect(await screen.findByTestId("mesa-de-ayuda-aprobaciones")).toBeTruthy();
  });

  it("N-05: «Cancelar» deja de rechazar; con nota escrita, confirma; aprobar con nota de rechazo, también", async () => {
    const alerta = jest.spyOn(Alert, "alert").mockImplementation((titulo, _m, botones) => {
      botones.find((b) => b.text === "Volver").onPress();
    });
    await render(<MesaDeAyuda />);
    await fireEvent.press(await screen.findByRole("button", { name: "No aprobar" }));
    await fireEvent.press(screen.getByRole("button", { name: "Cancelar: no rechazar la solicitud" }));
    expect(alerta).not.toHaveBeenCalled();
    expect(screen.queryByTestId("nota-3")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "No aprobar" }));
    await fireEvent.changeText(screen.getByTestId("nota-3"), "No corresponde");
    await fireEvent.press(screen.getByRole("button", { name: "Cancelar: no rechazar la solicitud" }));
    expect(alerta).toHaveBeenLastCalledWith("¿Descartar la nota?", expect.any(String), expect.any(Array), expect.any(Object));
    expect(screen.getByTestId("nota-3").props.value).toBe("No corresponde");

    await fireEvent.press(screen.getByRole("button", { name: "Aprobar" }));
    expect(alerta).toHaveBeenLastCalledWith("¿Aprobar TCK-2026-3?", expect.any(String), expect.any(Array), expect.any(Object));
    expect(soporteService.decidirAprobacion).not.toHaveBeenCalled();
  });

  it("G-6: si aún faltan otras aprobaciones, lo dice", async () => {
    soporteService.decidirAprobacion.mockResolvedValue({ numero: "TCK-2026-3", estado: "esperando_aprobacion" });
    await render(<MesaDeAyuda />);
    await fireEvent.press(await screen.findByRole("button", { name: "Aprobar" }));
    expect(await screen.findByText(`TCK-2026-3: ${TEXTO_FALTAN_OTRAS}`)).toBeTruthy();
  });
});
