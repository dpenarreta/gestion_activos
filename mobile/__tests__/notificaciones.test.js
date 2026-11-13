import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import { AccessibilityInfo } from "react-native";

import { notificacionesService } from "../src/api/servicios";
import {
  DetalleNotificacion,
  ESPERA_CARGANDO_MS,
  TEXTO_FUERA_DE_LA_APP,
  textoCambioDeEmpresa,
  textoSinEnlace,
} from "../src/pantallas/DetalleNotificacion";
import { agruparPorDia, ListaNotificaciones, TEXTO_TODAS_LEIDAS } from "../src/pantallas/ListaNotificaciones";

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (efecto) => React.useEffect(efecto, [efecto]),
  };
});

const mockSesion = {
  versionEmpresa: 0,
  empresas: [
    { id: 1, nombre: "Laar Courier" },
    { id: 7, nombre: "Laar Express" },
  ],
  cambiarEmpresaSiEsSuya: jest.fn(async () => true),
};
jest.mock("../src/sesion/SesionContext", () => ({
  useSesion: () => mockSesion,
}));

const mockContador = { noLeidas: 1, recargar: jest.fn(async () => {}) };
jest.mock("../src/notificaciones/ContadorContext", () => ({
  useContador: () => mockContador,
}));

jest.mock("../src/api/servicios", () => ({
  notificacionesService: {
    listar: jest.fn(),
    detalle: jest.fn(),
    leer: jest.fn(),
    leerTodas: jest.fn(),
  },
}));

/** Con la forma real de `NotificacionSerializer`. */
function notificacion(campos = {}) {
  return {
    id: 10,
    modulo: "soporte",
    modulo_nombre: "Mesa de ayuda",
    icono: "headset",
    tipo: "soporte.ticket_asignado",
    titulo: "Le asignaron un ticket",
    resumen: "Ticket #55: impresora",
    enlace: "/admin/ayuda/55",
    leida: false,
    leida_en: null,
    created_at: new Date().toISOString(),
    ...campos,
  };
}

function pagina(resultados, next = null) {
  return { count: resultados.length, next, results: resultados };
}

function errorDeRed() {
  const error = new Error("red");
  error.esDeRed = true;
  return error;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSesion.versionEmpresa = 0;
});

describe("lista de notificaciones", () => {
  it("muestra módulo, título y resumen, y pide la primera página", async () => {
    notificacionesService.listar.mockResolvedValue(
      pagina([notificacion(), notificacion({ id: 11, titulo: "Otra", leida: true })]),
    );

    await render(<ListaNotificaciones />);

    expect(await screen.findByText("Le asignaron un ticket")).toBeTruthy();
    expect(screen.getAllByText("Mesa de ayuda")).toHaveLength(2);
    expect(screen.getAllByText("Ticket #55: impresora")).toHaveLength(2);
    expect(notificacionesService.listar).toHaveBeenCalledWith({ pagina: 1, soloNoLeidas: false });
    expect(screen.getByLabelText(/^Sin leer\. Mesa de ayuda\. Le asignaron un ticket/)).toBeTruthy();
  });

  it("filtra por no leídas", async () => {
    notificacionesService.listar.mockResolvedValue(pagina([]));
    await render(<ListaNotificaciones />);
    await screen.findByText("No tiene notificaciones.");

    await fireEvent.press(screen.getByRole("radio", { name: "No leídas" }));

    expect(await screen.findByText("No tiene notificaciones sin leer.")).toBeTruthy();
    expect(notificacionesService.listar).toHaveBeenLastCalledWith({ pagina: 1, soloNoLeidas: true });
  });

  it("al tocar una notificación de un módulo que no está en la app abre su detalle", async () => {
    notificacionesService.listar.mockResolvedValue(pagina([notificacion()]));
    await render(<ListaNotificaciones />);

    await fireEvent.press(await screen.findByTestId("notificacion-10"));

    expect(mockRouter.push).toHaveBeenCalledWith("/notificacion/10");
  });

  it("si el módulo está en el mapa, la marca leída y va a su pantalla", async () => {
    notificacionesService.listar.mockResolvedValue(pagina([notificacion()]));
    notificacionesService.leer.mockResolvedValue(notificacion({ leida: true }));
    await render(<ListaNotificaciones mapa={{ soporte: "/ficticio" }} />);

    await fireEvent.press(await screen.findByTestId("notificacion-10"));

    expect(notificacionesService.leer).toHaveBeenCalledWith(10);
    expect(mockRouter.push).toHaveBeenCalledWith("/ficticio");
  });

  it("marca todas como leídas y lo anuncia", async () => {
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    notificacionesService.listar.mockResolvedValue(pagina([notificacion()]));
    notificacionesService.leerTodas.mockResolvedValue({ marcadas: 1 });
    await render(<ListaNotificaciones />);
    await screen.findByText("Le asignaron un ticket");

    await fireEvent.press(screen.getByRole("button", { name: "Marcar todas como leídas" }));

    expect(notificacionesService.leerTodas).toHaveBeenCalledTimes(1);
    expect(mockContador.recargar).toHaveBeenCalled();
    expect(anuncio).toHaveBeenCalledWith(TEXTO_TODAS_LEIDAS);
  });

  it("si falla un refresco con la lista cargada, la conserva y lo dice", async () => {
    notificacionesService.listar.mockResolvedValueOnce(pagina([notificacion()]));
    notificacionesService.leerTodas.mockResolvedValue({ marcadas: 1 });
    await render(<ListaNotificaciones />);
    await screen.findByText("Le asignaron un ticket");

    notificacionesService.listar.mockRejectedValueOnce(errorDeRed());
    await fireEvent.press(screen.getByRole("button", { name: "Marcar todas como leídas" }));

    expect(await screen.findByText(/Se muestran las anteriores\./)).toBeTruthy();
    expect(screen.getByText("Le asignaron un ticket")).toBeTruthy();

    // La siguiente carga sale bien: el aviso se va.
    notificacionesService.listar.mockResolvedValueOnce(pagina([notificacion({ leida: true })]));
    await fireEvent.press(screen.getByRole("button", { name: "Marcar todas como leídas" }));
    await waitFor(() => expect(screen.queryByText(/Se muestran las anteriores\./)).toBeNull());
  });

  it("si el refresco vuelve a fallar, el aviso se vuelve a anunciar", async () => {
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    notificacionesService.listar.mockResolvedValueOnce(pagina([notificacion()]));
    notificacionesService.leerTodas.mockResolvedValue({ marcadas: 0 });
    await render(<ListaNotificaciones />);
    await screen.findByText("Le asignaron un ticket");

    notificacionesService.listar.mockRejectedValue(errorDeRed());
    await fireEvent.press(screen.getByRole("button", { name: "Marcar todas como leídas" }));
    await screen.findByText(/Se muestran las anteriores\./);
    await fireEvent.press(screen.getByRole("button", { name: "Marcar todas como leídas" }));
    await screen.findByText(/Se muestran las anteriores\./);

    const avisos = anuncio.mock.calls.filter(([t]) => /Se muestran las anteriores/.test(t));
    expect(avisos).toHaveLength(2);
  });

  it("si falla «cargar más», lo dice en el pie con «Reintentar»", async () => {
    notificacionesService.listar.mockResolvedValueOnce(pagina([notificacion()], "pagina-2"));
    await render(<ListaNotificaciones />);
    await screen.findByText("Le asignaron un ticket");

    notificacionesService.listar.mockRejectedValueOnce(errorDeRed());
    await fireEvent(screen.getByTestId("lista-notificaciones"), "endReached");
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeTruthy();
    expect(screen.getByText("Le asignaron un ticket")).toBeTruthy();

    notificacionesService.listar.mockResolvedValueOnce(pagina([notificacion({ id: 12, titulo: "La de la página 2" })]));
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("La de la página 2")).toBeTruthy();
    expect(notificacionesService.listar).toHaveBeenLastCalledWith({ pagina: 2, soloNoLeidas: false });
  });

  it("si falla la carga ofrece «Reintentar»", async () => {
    notificacionesService.listar.mockRejectedValueOnce(errorDeRed());
    await render(<ListaNotificaciones />);

    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeTruthy();
    notificacionesService.listar.mockResolvedValue(pagina([notificacion()]));
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Le asignaron un ticket")).toBeTruthy();
  });

  it("al cambiar de empresa vuelve a pedir la lista", async () => {
    notificacionesService.listar.mockResolvedValue(pagina([notificacion()]));
    const { rerender } = await render(<ListaNotificaciones />);
    await screen.findByText("Le asignaron un ticket");
    expect(notificacionesService.listar).toHaveBeenCalledTimes(1);

    mockSesion.versionEmpresa = 1;
    await rerender(<ListaNotificaciones />);

    await waitFor(() => expect(notificacionesService.listar).toHaveBeenCalledTimes(2));
  });
});

describe("detalle de una notificación fuera de la app", () => {
  it("la marca leída y abre la web con el enlace y la empresa", async () => {
    notificacionesService.detalle.mockResolvedValue(notificacion({ empresa: 2 }));
    notificacionesService.leer.mockResolvedValue(notificacion({ empresa: 2, leida: true }));

    await render(<DetalleNotificacion id="10" />);

    expect(await screen.findByText(TEXTO_FUERA_DE_LA_APP)).toBeTruthy();
    expect(notificacionesService.leer).toHaveBeenCalledWith("10", { empresa: null });
    expect(mockContador.recargar).toHaveBeenCalled();
    expect(mockSesion.cambiarEmpresaSiEsSuya).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Abrir en el navegador" }));
    expect(Linking.openURL).toHaveBeenCalledWith(
      "https://intranet.laarcourier.com/admin/ayuda/55?empresa=2",
    );
  });

  it("desde un push de la empresa activa no avisa de ningún cambio", async () => {
    mockSesion.cambiarEmpresaSiEsSuya.mockResolvedValueOnce(false);
    notificacionesService.detalle.mockResolvedValue(notificacion({ leida: true }));
    await render(<DetalleNotificacion id="10" empresa="1" />);
    await screen.findByText(TEXTO_FUERA_DE_LA_APP);
    expect(screen.queryByText(/la app pasó a esa empresa/)).toBeNull();
  });

  it("desde un push usa su empresa como X-Empresa y pasa a ella", async () => {
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    notificacionesService.detalle.mockResolvedValue(notificacion());
    notificacionesService.leer.mockResolvedValue(notificacion({ leida: true }));

    await render(<DetalleNotificacion id="10" empresa="7" />);
    await screen.findByText(TEXTO_FUERA_DE_LA_APP);

    expect(notificacionesService.detalle).toHaveBeenCalledWith("10", { empresa: "7" });
    expect(notificacionesService.leer).toHaveBeenCalledWith("10", { empresa: "7" });
    expect(mockSesion.cambiarEmpresaSiEsSuya).toHaveBeenCalledWith("7");
    expect(await screen.findByText(textoCambioDeEmpresa("Laar Express"))).toBeTruthy();
    expect(anuncio).toHaveBeenCalledWith(
      "Esta notificación es de Laar Express: la app pasó a esa empresa.",
    );
    // La API aún no trae `empresa`: el enlace usa la del push.
    await fireEvent.press(screen.getByRole("button", { name: "Abrir en el navegador" }));
    expect(Linking.openURL).toHaveBeenCalledWith(
      "https://intranet.laarcourier.com/admin/ayuda/55?empresa=7",
    );
  });

  it("sin enlace válido no muestra el botón y dice dónde buscarla", async () => {
    notificacionesService.detalle.mockResolvedValue(notificacion({ enlace: "", leida: true }));
    await render(<DetalleNotificacion id="10" />);

    expect(await screen.findByText(textoSinEnlace("Mesa de ayuda"))).toBeTruthy();
    expect(screen.queryByText(TEXTO_FUERA_DE_LA_APP)).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir en el navegador" })).toBeNull();
    expect(notificacionesService.leer).not.toHaveBeenCalled();
  });

  it("si no se puede abrir el navegador lo dice junto al botón", async () => {
    notificacionesService.detalle.mockResolvedValue(notificacion({ leida: true }));
    Linking.openURL.mockRejectedValueOnce(new Error("no"));
    const WebBrowser = require("expo-web-browser");
    WebBrowser.openBrowserAsync.mockRejectedValueOnce(new Error("no"));
    await render(<DetalleNotificacion id="10" />);
    await screen.findByText(TEXTO_FUERA_DE_LA_APP);

    await fireEvent.press(screen.getByRole("button", { name: "Abrir en el navegador" }));

    expect(await screen.findByText(/No se pudo abrir el navegador del teléfono/)).toBeTruthy();
  });

  it("si su módulo está en el mapa, reemplaza el detalle por esa pantalla (push)", async () => {
    notificacionesService.detalle.mockResolvedValue(notificacion({ modulo: "ficticio", leida: true }));
    await render(<DetalleNotificacion id="10" mapa={{ ficticio: (n) => `/ficticio/${n.id}` }} />);

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/ficticio/10"));
    // Nunca dijo «Cargando la notificación…»: solo un estado neutro (H-21).
    expect(screen.queryByText("Cargando la notificación…")).toBeNull();
    expect(screen.getByTestId("abriendo-notificacion")).toBeTruthy();
  });

  it("si tarda, al rato sí dice «Cargando la notificación…» (H-21)", async () => {
    jest.useFakeTimers();
    try {
      notificacionesService.detalle.mockReturnValue(new Promise(() => {}));
      await render(<DetalleNotificacion id="10" />);
      expect(screen.getByLabelText("Abriendo la notificación…")).toBeTruthy();
      expect(screen.queryByText("Cargando la notificación…")).toBeNull();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ESPERA_CARGANDO_MS);
      });
      expect(screen.getByText("Cargando la notificación…")).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("agrupación por día (H-23) y cabecera en una fila (H-11)", () => {
  const AHORA = new Date(2026, 10, 12, 15, 0);
  const AYER = new Date(2026, 10, 11, 9, 0);
  const ANTES = new Date(2026, 10, 2, 9, 0);

  it("agruparPorDia pone «Hoy», «Ayer» y «Anteriores» una vez cada uno", () => {
    const filas = agruparPorDia(
      [
        notificacion({ id: 1, created_at: AHORA.toISOString() }),
        notificacion({ id: 2, created_at: AHORA.toISOString() }),
        notificacion({ id: 3, created_at: AYER.toISOString() }),
        notificacion({ id: 4, created_at: ANTES.toISOString() }),
        notificacion({ id: 5, created_at: ANTES.toISOString() }),
      ],
      AHORA,
    );
    expect(filas.map((f) => f.encabezado ?? f.notificacion.id)).toEqual(["Hoy", 1, 2, "Ayer", 3, "Anteriores", 4, 5]);
  });

  it("la lista muestra los grupos como encabezados", async () => {
    const hoy = new Date();
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    notificacionesService.listar.mockResolvedValue(
      pagina([
        notificacion({ id: 1, created_at: hoy.toISOString() }),
        notificacion({ id: 2, titulo: "De ayer", created_at: ayer.toISOString() }),
      ]),
    );
    await render(<ListaNotificaciones />);
    await screen.findByText("De ayer");
    const encabezados = screen.getAllByRole("header");
    expect(encabezados).toHaveLength(3);
    ["Mostrar", "Hoy", "Ayer"].forEach((texto, i) => expect(encabezados[i]).toHaveTextContent(texto, { exact: true }));
  });

  it("a las 00:00:05 «Hoy» pasa a «Ayer» solo, sin otro render (O3)", async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 12, 23, 59, 0), doNotFake: ["nextTick", "setImmediate"] });
    try {
      notificacionesService.listar.mockResolvedValue(
        pagina([notificacion({ id: 1, titulo: "De anoche", created_at: new Date(2026, 10, 12, 23, 0).toISOString() })]),
      );
      const { unmount } = await render(<ListaNotificaciones />);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole("header", { name: "Hoy" })).toBeTruthy();
      // 1 min y 5 s después: el temporizador de la medianoche vuelve a dibujar.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(65_000);
      });
      expect(screen.getByRole("header", { name: "Ayer" })).toBeTruthy();
      await unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it("al pasar la medianoche, el siguiente render pasa «Hoy» a «Ayer» (B4)", async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 12, 23, 50), doNotFake: ["nextTick", "setImmediate"] });
    try {
      notificacionesService.listar.mockResolvedValue(
        pagina([notificacion({ id: 1, titulo: "De anoche", created_at: new Date(2026, 10, 12, 23, 0).toISOString() })]),
      );
      const { rerender } = await render(<ListaNotificaciones />);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByRole("header", { name: "Hoy" })).toBeTruthy();
      jest.setSystemTime(new Date(2026, 10, 13, 0, 5));
      await rerender(<ListaNotificaciones />);
      expect(screen.getByRole("header", { name: "Ayer" })).toBeTruthy();
      expect(screen.queryByRole("header", { name: "Hoy" })).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("«Mostrar» sigue a la vista y «Marcar todas» es un ícono con nombre", async () => {
    notificacionesService.listar.mockResolvedValue(pagina([notificacion()]));
    await render(<ListaNotificaciones />);
    await screen.findByText("Le asignaron un ticket");
    expect(screen.getByText("Mostrar")).toBeTruthy();
    const marcar = screen.getByTestId("marcar-todas");
    expect(marcar.props.accessibilityLabel).toBe("Marcar todas como leídas");
    expect(marcar.props.accessibilityRole).toBe("button");
  });
});
