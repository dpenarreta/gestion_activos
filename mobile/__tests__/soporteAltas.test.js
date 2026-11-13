import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { AccessibilityInfo, AppState } from "react-native";

import { soporteService } from "../src/api/servicios";
import { TEXTO_MAXIMO_ADJUNTOS, TEXTO_TIPO_NO_PERMITIDO } from "../src/soporte/adjuntos";
import { TEXTO_MODULO_APAGADO, TEXTO_PUEDE_HABERSE_ENVIADO } from "../src/soporte/formato";
import { ESPERA_ANUNCIO_SUGERENCIAS_MS, TEXTO_SIN_SUGERENCIAS } from "../src/pantallas/soporte/FormularioDelTicket";
import { NuevoTicket, TEXTO_SIN_PERMISO_PARA_CREAR, textoFaltanDatos } from "../src/pantallas/soporte/NuevoTicket";
import {
  ESPERA_BUSCAR_MS,
  RegistrarTicket,
  TEXTO_FALTAN_DATOS,
  TEXTO_SIN_NOMBRE,
} from "../src/pantallas/soporte/RegistrarTicket";
import { TEXTO_HAY_MAS, TEXTO_MINIMO_BUSQUEDA } from "../src/utils/busqueda";

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    useNavigation: () => ({ setOptions: jest.fn(), dispatch: jest.fn() }),
    usePreventRemove: () => {},
    useLocalSearchParams: () => ({}),
    useFocusEffect: (efecto) => React.useEffect(efecto, [efecto]),
  };
});

const mockSesion = { usuario: { permissions: ["soporte.crear"] }, empresaActiva: { id: 1 }, versionEmpresa: 0 };
jest.mock("../src/sesion/SesionContext", () => ({ useSesion: () => mockSesion }));

const mockResumen = { recargar: jest.fn(async () => {}), informarMisTickets: jest.fn() };
jest.mock("../src/soporte/ResumenSoporteContext", () => ({
  useResumenSoporte: () => mockResumen,
  useRecargarResumenSoporte: () => mockResumen,
}));

jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});

jest.mock("../src/api/servicios", () => ({
  soporteService: {
    formularioPropio: jest.fn(),
    crearTicket: jest.fn(),
    formularioInterno: jest.fn(),
    personas: jest.fn(),
    registrar: jest.fn(),
  },
}));

function error(status, code, message, details = null) {
  const e = new Error(message);
  e.response = { status, data: { error: { code, message, details } } };
  return e;
}

function anunciados() {
  return AccessibilityInfo.announceForAccessibility.mock.calls.map(([t]) => t);
}

const CATEGORIAS = [
  {
    id: 1,
    nombre: "Impresoras",
    descripcion: "",
    casos: [
      { id: 11, nombre: "Impresora no imprime", tipo: "incidente", tipo_display: "Incidente", prioridad: "media" },
      { id: 12, nombre: "Papel atascado", tipo: "incidente", tipo_display: "Incidente", prioridad: "baja" },
    ],
  },
  { id: 2, nombre: "Correo", descripcion: "", casos: [{ id: 21, nombre: "No puedo enviar correos", tipo_display: "Incidente", prioridad: "media" }] },
];

const CAMPOS = [
  { clave: "categoria", etiqueta: "Categoría", tipo: "lista", obligatorio: true, base: true, categorias: [], opciones: [], ayuda: "" },
  { clave: "caso", etiqueta: "Caso de ayuda", tipo: "lista", obligatorio: true, base: true, categorias: [], opciones: [], ayuda: "" },
  { clave: "descripcion", etiqueta: "Describa el problema", tipo: "parrafo", obligatorio: true, base: true, categorias: [], opciones: [], ayuda: "" },
  { clave: "impacto", etiqueta: "¿A quién afecta?", tipo: "lista", obligatorio: false, base: true, categorias: [], opciones: [], ayuda: "" },
  { clave: "urgencia", etiqueta: "¿Puede seguir trabajando?", tipo: "lista", obligatorio: false, base: true, categorias: [], opciones: [], ayuda: "" },
  { clave: "equipo", etiqueta: "Código del equipo", tipo: "texto", obligatorio: true, base: false, categorias: [1], opciones: [], ayuda: "Está en la etiqueta" },
];

/** Con la forma de `SolicitarView.get`. */
function formulario(campos = {}) {
  return {
    disponible: true,
    campos: CAMPOS,
    agencias: [{ id: 1, nombre: "Matriz" }],
    areas: [{ id: 1, nombre: "Cartera" }],
    categorias: CATEGORIAS,
    impactos: [
      { id: "bajo", nombre: "Solo a mí" },
      { id: "medio", nombre: "A mi área o grupo de trabajo" },
      { id: "alto", nombre: "A toda la agencia, la sucursal o la empresa" },
    ],
    urgencias: [
      { id: "alta", nombre: "No, la operación está detenida" },
      { id: "media", nombre: "Sí, pero con dificultad" },
      { id: "baja", nombre: "Sí, puede esperar" },
    ],
    mis_datos: {
      nombre: "Ana Pérez",
      correo: "ana@grupolaar.com",
      telefono: "",
      telefono_corporativo: "022345678",
      area: { id: 1, nombre: "Cartera" },
      agencia: { id: 1, nombre: "Matriz" },
      faltan: [],
    },
    puede_crear: true,
    ...campos,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  AppState.currentState = "active";
  mockSesion.usuario = { permissions: ["soporte.crear"] };
  soporteService.formularioPropio.mockResolvedValue(formulario());
});

afterEach(() => {
  jest.useRealTimers();
});

async function describirYElegirSugerencia() {
  jest.useFakeTimers();
  await fireEvent.changeText(screen.getByTestId("campo-descripcion"), "La impresora no imprime nada");
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ESPERA_ANUNCIO_SUGERENCIAS_MS);
  });
  jest.useRealTimers();
}

describe("nuevo ticket: describir primero y la sugerencia de caso (CA-4)", () => {
  it("sugiere hasta 3 casos y elegir uno llena la categoría y el caso", async () => {
    await render(<NuevoTicket />);
    expect(await screen.findByRole("header", { name: "¿En qué le ayudamos?" })).toBeTruthy();
    expect(soporteService.formularioPropio).toHaveBeenCalledWith({ desdeLaMesa: false });
    await describirYElegirSugerencia();
    expect(anunciados()).toContain("1 caso sugerido bajo la descripción.");
    expect(screen.getByText(/¿Es alguno de estos\?/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Impresoras › Impresora no imprime" }));
    expect(screen.getByRole("button", { name: "Impresoras › Impresora no imprime, elegido" })).toBeTruthy();
    expect(screen.getByTestId("campo-categoria").props.accessibilityLabel).toContain("Elegido: Impresoras");
    expect(screen.getByTestId("campo-caso").props.accessibilityLabel).toContain("Elegido: Impresora no imprime");
    // El campo propio de «Impresoras» aparece al elegirla.
    expect(screen.getByTestId("campo-equipo")).toBeTruthy();
  });

  it("sin parecidos lo dice; también se elige de la lista", async () => {
    await render(<NuevoTicket />);
    await screen.findByTestId("campo-descripcion");
    // H-19: mientras se escribe no se dice nada; tras la pausa, sí.
    jest.useFakeTimers();
    await fireEvent.changeText(screen.getByTestId("campo-descripcion"), "Necesito una silla nueva para mi puesto");
    expect(screen.queryByText(TEXTO_SIN_SUGERENCIAS)).toBeNull();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ESPERA_ANUNCIO_SUGERENCIAS_MS);
    });
    jest.useRealTimers();
    expect(screen.getByText(TEXTO_SIN_SUGERENCIAS)).toBeTruthy();
    expect(screen.getByTestId("campo-caso").props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId("campo-categoria"));
    await fireEvent.press(screen.getByTestId("campo-categoria-opcion-2"));
    await fireEvent.press(screen.getByTestId("campo-caso"));
    await fireEvent.press(screen.getByTestId("campo-caso-opcion-21"));
    expect(screen.getByTestId("campo-caso").props.accessibilityLabel).toContain("Elegido: No puedo enviar correos");
    expect(screen.queryByTestId("campo-equipo")).toBeNull();
  });

  it("valida los obligatorios y lleva el foco al primero que falta", async () => {
    jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
    await render(<NuevoTicket />);
    await screen.findByTestId("campo-descripcion");
    jest.useFakeTimers();
    await fireEvent.press(screen.getByRole("button", { name: "Crear ticket" }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(soporteService.crearTicket).not.toHaveBeenCalled();
    expect(screen.getByText("Revise los campos marcados.")).toBeTruthy();
    expect(screen.getByTestId("campo-descripcion").props.accessibilityLabel).toContain("Error: Cuéntenos qué pasa.");
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(expect.anything(), "focus");
  });

  it("envía en multipart con los adicionales, y muestra el número, la cola y el fuera de horario", async () => {
    soporteService.crearTicket.mockResolvedValue({ id: 70, numero: "TCK-2026-70", posicion: 3, estado: "nuevo", fuera_de_horario: true });
    await render(<NuevoTicket />);
    await screen.findByTestId("campo-descripcion");
    await describirYElegirSugerencia();
    await fireEvent.press(screen.getByRole("button", { name: "Impresoras › Impresora no imprime" }));
    await fireEvent.changeText(screen.getByTestId("campo-equipo"), "PC-123");
    await fireEvent.press(screen.getByRole("radio", { name: "Solo a mí" }));
    await fireEvent.press(screen.getByRole("button", { name: "Crear ticket" }));
    expect(soporteService.crearTicket).toHaveBeenCalledWith(
      {
        caso: "11",
        descripcion: "La impresora no imprime nada",
        impacto: "bajo",
        urgencia: "",
        adicionales: JSON.stringify({ equipo: "PC-123" }),
      },
      [],
      { desdeLaMesa: false },
    );
    expect(await screen.findByRole("header", { name: "Recibimos su solicitud" })).toBeTruthy();
    expect(screen.getByText("Hay 2 tickets antes que el suyo.")).toBeTruthy();
    expect(screen.getByText(/fuera del horario de atención/)).toBeTruthy();
    expect(mockResumen.recargar).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Ver mi ticket" }));
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/soporte/mi-ticket/[id]", params: { id: "70" } });
  });

  it("CA-22: con un fallo de red conserva lo escrito y avisa que puede haberse enviado", async () => {
    let rechazar;
    soporteService.crearTicket.mockReturnValue(new Promise((_, r) => (rechazar = r)));
    await render(<NuevoTicket />);
    await screen.findByTestId("campo-descripcion");
    await describirYElegirSugerencia();
    await fireEvent.press(screen.getByRole("button", { name: "Impresoras › Impresora no imprime" }));
    await fireEvent.changeText(screen.getByTestId("campo-equipo"), "PC-123");
    await fireEvent.press(screen.getByTestId("crear-ticket"));
    await fireEvent.press(screen.getByTestId("crear-ticket"));
    expect(soporteService.crearTicket).toHaveBeenCalledTimes(1);
    await act(async () => rechazar(Object.assign(new Error("red"), { esDeRed: true })));
    expect(await screen.findByText(TEXTO_PUEDE_HABERSE_ENVIADO)).toBeTruthy();
    expect(screen.getByTestId("campo-descripcion").props.value).toBe("La impresora no imprime nada");
    expect(screen.getByTestId("campo-equipo").props.value).toBe("PC-123");
  });

  it("los errores por campo del servidor salen junto a cada campo", async () => {
    soporteService.crearTicket.mockRejectedValue(error(400, "invalid", "Error en la solicitud.", { equipo: ["Escriba como máximo 200 caracteres."] }));
    await render(<NuevoTicket />);
    await screen.findByTestId("campo-descripcion");
    await describirYElegirSugerencia();
    await fireEvent.press(screen.getByRole("button", { name: "Impresoras › Impresora no imprime" }));
    await fireEvent.changeText(screen.getByTestId("campo-equipo"), "PC-123");
    await fireEvent.press(screen.getByTestId("crear-ticket"));
    expect(await screen.findByText("Revise los campos marcados.")).toBeTruthy();
    expect(screen.getByTestId("campo-equipo").props.accessibilityLabel).toContain("Error: Escriba como máximo 200 caracteres.");
  });

  it("con «Crear tickets en la Mesa» usa la ruta de la Mesa; sin ningún permiso, lo dice", async () => {
    mockSesion.usuario = { permissions: ["soporte.mesa_crear"] };
    await render(<NuevoTicket />);
    await screen.findByTestId("campo-descripcion");
    expect(soporteService.formularioPropio).toHaveBeenCalledWith({ desdeLaMesa: true });

    mockSesion.usuario = { permissions: [] };
    await render(<NuevoTicket />);
    expect(await screen.findByText(TEXTO_SIN_PERMISO_PARA_CREAR)).toBeTruthy();
  });

  it("CA-3: con el módulo apagado lo dice claro", async () => {
    soporteService.formularioPropio.mockRejectedValue(error(403, "modulo_apagado", "El módulo «Mesa de ayuda» está apagado en la empresa."));
    await render(<NuevoTicket />);
    expect(await screen.findByText(TEXTO_MODULO_APAGADO)).toBeTruthy();
  });

  it("valida los adjuntos al elegirlos: tipo no permitido y máximo 3 (CA-18)", async () => {
    ImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///cache/ImagePicker/a.heic", fileName: "a.heic", mimeType: "image/heic", fileSize: 100 }],
    });
    await render(<NuevoTicket />);
    await screen.findByTestId("campo-descripcion");
    await fireEvent.press(screen.getByTestId("adjuntos-adjuntar"));
    await fireEvent.press(screen.getByTestId("adjuntos-galeria"));
    expect(await screen.findByText(TEXTO_TIPO_NO_PERMITIDO)).toBeTruthy();

    ImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///cache/ImagePicker/b.jpg", fileName: "b.jpg", mimeType: "image/jpeg", fileSize: 100 }],
    });
    for (let i = 0; i < 3; i += 1) {
      await fireEvent.press(screen.getByTestId("adjuntos-adjuntar"));
      await fireEvent.press(screen.getByTestId("adjuntos-galeria"));
    }
    await waitFor(() => expect(screen.getByTestId("adjuntos-elegido-2")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Adjuntar foto o archivo (máximo 3): ya eligió 3" })).toBeTruthy();
    await fireEvent.press(screen.getByTestId("adjuntos-adjuntar"));
    await fireEvent.press(screen.getByTestId("adjuntos-galeria"));
    expect(await screen.findByText(TEXTO_MAXIMO_ADJUNTOS)).toBeTruthy();
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(4);
  });
});

describe("nuevo ticket: faltan datos del perfil (CA-5)", () => {
  it("al abrir, explica qué falta y ofrece completarlo en el navegador", async () => {
    soporteService.formularioPropio.mockResolvedValue(
      formulario({ mis_datos: { ...formulario().mis_datos, area: null, agencia: null } }),
    );
    await render(<NuevoTicket />);
    expect(await screen.findByText(textoFaltanDatos(["área", "agencia"]))).toBeTruthy();
    expect(screen.queryByTestId("campo-descripcion")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Completar «Mi perfil» en el navegador" }));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/\/admin\/perfil\?empresa=1$/));

    soporteService.formularioPropio.mockResolvedValue(formulario());
    await fireEvent.press(screen.getByRole("button", { name: "Ya lo completé: revisar de nuevo" }));
    expect(await screen.findByTestId("campo-descripcion")).toBeTruthy();
  });

  it("si el servidor responde `faltan_datos`, lo dice sin perder lo escrito", async () => {
    soporteService.crearTicket.mockRejectedValue(
      error(400, "faltan_datos", "Error en la solicitud.", { faltan: ["Agencia"], mis_datos: ["Complete su perfil (Agencia) para crear el ticket."] }),
    );
    await render(<NuevoTicket />);
    await screen.findByTestId("campo-descripcion");
    await fireEvent.changeText(screen.getByTestId("campo-descripcion"), "Necesito una silla nueva para mi puesto");
    await fireEvent.press(screen.getByTestId("campo-categoria"));
    await fireEvent.press(screen.getByTestId("campo-categoria-opcion-2"));
    await fireEvent.press(screen.getByTestId("campo-caso"));
    await fireEvent.press(screen.getByTestId("campo-caso-opcion-21"));
    await fireEvent.press(screen.getByTestId("crear-ticket"));
    expect(await screen.findByText(textoFaltanDatos(["agencia"]))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Completar «Mi perfil» en el navegador" })).toBeTruthy();
    expect(screen.getByTestId("campo-descripcion").props.value).toBe("Necesito una silla nueva para mi puesto");
  });
});

/** Con la forma de `tickets/personas/` (`contacto.de`). */
function persona(campos = {}) {
  return {
    id: 5,
    nombre: "Carla Ruiz",
    correo: "carla@grupolaar.com",
    telefono: "",
    telefono_corporativo: "0991111111",
    area: { id: 1, nombre: "Cartera" },
    agencia: { id: 1, nombre: "Matriz" },
    faltan: [],
    ...campos,
  };
}

describe("registrar a nombre de otra persona (CA-16)", () => {
  beforeEach(() => {
    soporteService.formularioInterno.mockResolvedValue(
      formulario({
        canales: [
          { id: "telefono", nombre: "Teléfono" },
          { id: "whatsapp", nombre: "WhatsApp" },
          { id: "presencial", nombre: "Presencial" },
        ],
        soy_tecnico: true,
      }),
    );
    soporteService.personas.mockResolvedValue([persona()]);
  });

  async function buscar(texto) {
    jest.useFakeTimers();
    await fireEvent.changeText(screen.getByTestId("buscar-persona-campo"), texto);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ESPERA_BUSCAR_MS);
    });
    jest.useRealTimers();
  }

  it("busca desde 2 letras, con una pausa, y muestra como mucho 8 con «Hay más…»", async () => {
    await render(<RegistrarTicket />);
    expect(await screen.findByText(TEXTO_MINIMO_BUSQUEDA)).toBeTruthy();
    await buscar("c");
    expect(soporteService.personas).not.toHaveBeenCalled();

    soporteService.personas.mockResolvedValue(Array.from({ length: 11 }, (_, i) => persona({ id: 100 + i, nombre: `Persona ${i + 1}` })));
    await buscar("ca");
    expect(soporteService.personas).toHaveBeenCalledWith("ca");
    expect(screen.getAllByRole("button", { name: /^Persona \d+\./ })).toHaveLength(8);
    expect(screen.getByText(TEXTO_HAY_MAS)).toBeTruthy();
    expect(anunciados()).toContain(`11 personas encontradas; se muestran 8. ${TEXTO_HAY_MAS}`);
  });

  it("registra con el canal, la sugerencia y «Asignármelo», y abre la ficha", async () => {
    soporteService.registrar.mockResolvedValue({ id: 80, numero: "TCK-2026-80", estado: "asignado" });
    await render(<RegistrarTicket />);
    await screen.findByTestId("buscar-persona-campo");
    await buscar("carla");
    await fireEvent.press(screen.getByRole("button", { name: /^Carla Ruiz\./ }));
    expect(screen.getByLabelText("Nombre: Carla Ruiz")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Teléfono", checked: true })).toBeTruthy();
    // En tercera persona: quien registra no es quien tiene el problema.
    expect(screen.getByRole("radio", { name: "Solo a la persona que lo reporta" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "WhatsApp" }));
    jest.useFakeTimers();
    await fireEvent.changeText(screen.getByTestId("campo-descripcion"), "No puede enviar correos a clientes");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ESPERA_ANUNCIO_SUGERENCIAS_MS);
    });
    jest.useRealTimers();
    await fireEvent.press(screen.getByRole("button", { name: "Correo › No puedo enviar correos" }));
    await fireEvent.press(screen.getByRole("checkbox", { name: "Asignármelo (lo atiendo ahora)" }));
    await fireEvent.press(screen.getByRole("button", { name: "Registrar ticket" }));
    expect(soporteService.registrar).toHaveBeenCalledWith(
      {
        caso: "21",
        descripcion: "No puede enviar correos a clientes",
        impacto: "",
        urgencia: "",
        solicitante: 5,
        canal: "whatsapp",
        asignarme: "true",
        adicionales: "{}",
      },
      [],
    );
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/soporte/ticket/[id]", params: { id: "80" } }),
    );
  });

  it("a quien le faltan área o agencia se le completan aquí; con `faltan_datos` se marcan", async () => {
    soporteService.personas.mockResolvedValue([persona({ agencia: null })]);
    soporteService.registrar.mockRejectedValueOnce(
      error(400, "faltan_datos", "Error en la solicitud.", { faltan: ["Área"], solicitante: ["A esta persona le falta Área: complételo en el formulario."] }),
    );
    await render(<RegistrarTicket />);
    await screen.findByTestId("buscar-persona-campo");
    await buscar("carla");
    expect(screen.getByRole("button", { name: /Datos incompletos$/ })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: /^Carla Ruiz\./ }));
    expect(screen.getByText(TEXTO_FALTAN_DATOS)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("campo-descripcion"), "Necesito una silla nueva para mi puesto");
    await fireEvent.press(screen.getByTestId("campo-categoria"));
    await fireEvent.press(screen.getByTestId("campo-categoria-opcion-2"));
    await fireEvent.press(screen.getByTestId("campo-caso"));
    await fireEvent.press(screen.getByTestId("campo-caso-opcion-21"));
    await fireEvent.press(screen.getByRole("button", { name: "Registrar ticket" }));
    expect(soporteService.registrar).not.toHaveBeenCalled();
    expect(screen.getByTestId("completar-agencia").props.accessibilityLabel).toContain("Error: Elija la agencia de la persona.");

    await fireEvent.press(screen.getByTestId("completar-agencia"));
    await fireEvent.press(screen.getByTestId("completar-agencia-opcion-1"));
    await fireEvent.press(screen.getByRole("button", { name: "Registrar ticket" }));
    expect(soporteService.registrar).toHaveBeenCalledWith(expect.objectContaining({ sede: "1", solicitante: 5 }), []);
    expect(await screen.findByText("A esta persona le falta área: complételo para este ticket.")).toBeTruthy();
    expect(screen.getByTestId("completar-area").props.accessibilityLabel).toContain("Error: Elija el área de la persona.");
    expect(screen.getByTestId("campo-descripcion").props.value).toBe("Necesito una silla nueva para mi puesto");
  });

  it("G-11: si a la persona le falta el nombre, se corrige en su perfil, sin campos para completarlo", async () => {
    soporteService.personas.mockResolvedValue([persona({ nombre: "" })]);
    await render(<RegistrarTicket />);
    await screen.findByTestId("buscar-persona-campo");
    await buscar("carla");
    await fireEvent.press(screen.getByRole("button", { name: /^carla@grupolaar\.com\./ }));
    expect(screen.getByText(TEXTO_SIN_NOMBRE)).toBeTruthy();
    expect(screen.queryByTestId("completar-nombre")).toBeNull();
    const boton = screen.getByRole("button", { name: "Registrar ticket" });
    expect(boton.props.accessibilityState.disabled).toBe(true);
    expect(soporteService.registrar).not.toHaveBeenCalled();
  });
});
