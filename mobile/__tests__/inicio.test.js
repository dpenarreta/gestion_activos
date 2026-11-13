import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { AccessibilityInfo, Platform, Text } from "react-native";

import { inicioService, notificacionesService } from "../src/api/servicios";
import { ContadorProvider, useContador } from "../src/notificaciones/ContadorContext";
import { CarruselNoticias } from "../src/pantallas/CarruselNoticias";
import * as ChatContext from "../src/chat/ChatContext";
import * as ContadorContext from "../src/notificaciones/ContadorContext";
import * as ResumenPermisos from "../src/permisos/ResumenPermisosContext";
import { ACCESOS, avisosDeOtrosModulos, Inicio, pendientesDeHoy, TEXTO_SIN_CARGO } from "../src/pantallas/Inicio";

const mockRouter = { push: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));

const mockSesion = {
  usuario: { username: "ana", first_name: "Ana", permissions: [] },
  empresaActiva: { id: 1 },
  versionEmpresa: 0,
};
jest.mock("../src/sesion/SesionContext", () => ({
  useSesion: () => mockSesion,
}));

jest.mock("../src/api/servicios", () => ({
  inicioService: {
    misDatos: jest.fn(),
    noticias: jest.fn(),
    carrusel: jest.fn(async () => ({ segundos: 6 })),
    rutaImagenNoticia: (id) => `https://api/organizacion/noticias/${id}/imagen/`,
  },
  notificacionesService: { resumen: jest.fn() },
}));

/** Una promesa que se resuelve a mano. */
function pendiente() {
  let resolver;
  let rechazar;
  const promesa = new Promise((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

const NOTICIAS = [
  { id: 1, titulo: "Aniversario", descripcion: "Celebramos 20 años", texto_alternativo: "Equipo en la oficina" },
  { id: 2, titulo: "Capacitación", descripcion: "", texto_alternativo: "" },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockSesion.versionEmpresa = 0;
  inicioService.noticias.mockResolvedValue([]);
  inicioService.misDatos.mockResolvedValue({ nombres: "Ana", cargo: null });
});

describe("Inicio: el cargo", () => {
  it("mientras carga no dice que no tiene cargo", async () => {
    const perfil = pendiente();
    inicioService.misDatos.mockReturnValue(perfil.promesa);
    await render(<Inicio />);

    expect(screen.getByText("Hola, Ana")).toBeTruthy();
    expect(screen.queryByText(new RegExp(TEXTO_SIN_CARGO.slice(0, 20)))).toBeNull();

    await act(async () => perfil.resolver({ cargo: { nombre: "Analista de cartera" } }));
    expect(await screen.findByText("Analista de cartera.")).toBeTruthy();
  });

  it("si falla, tampoco lo dice", async () => {
    inicioService.misDatos.mockRejectedValue(new Error("500"));
    await render(<Inicio />);
    await screen.findByText("No hay noticias publicadas por ahora.");

    expect(screen.queryByText(new RegExp(TEXTO_SIN_CARGO.slice(0, 20)))).toBeNull();
  });

  it("si cargó y no tiene cargo, lo dice con el enlace a Mi perfil", async () => {
    await render(<Inicio />);
    expect(await screen.findByText(new RegExp(TEXTO_SIN_CARGO.slice(0, 20)))).toBeTruthy();
  });

  it("sin nombre, da la bienvenida", async () => {
    const usuario = mockSesion.usuario;
    mockSesion.usuario = { username: "", permissions: [] };
    inicioService.misDatos.mockResolvedValue({});
    await render(<Inicio />);
    expect(screen.getByText("Le damos la bienvenida")).toBeTruthy();
    mockSesion.usuario = usuario;
  });
});

describe("Inicio: las noticias", () => {
  it("sin noticias lo dice", async () => {
    await render(<Inicio />);
    expect(await screen.findByText("No hay noticias publicadas por ahora.")).toBeTruthy();
  });

  it("si fallan ofrece «Reintentar»", async () => {
    inicioService.noticias.mockRejectedValueOnce(new Error("red"));
    await render(<Inicio />);

    expect(await screen.findByText("No se pudieron cargar las noticias.")).toBeTruthy();
    inicioService.noticias.mockResolvedValueOnce(NOTICIAS);
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Aniversario")).toBeTruthy();
  });

  it("el pull-to-refresh no desmonta el carrusel y, si falla, conserva las noticias", async () => {
    inicioService.noticias.mockResolvedValueOnce(NOTICIAS);
    await render(<Inicio />);
    expect(await screen.findByText("Aniversario")).toBeTruthy();

    const recarga = pendiente();
    inicioService.noticias.mockReturnValueOnce(recarga.promesa);
    const refresco = screen.getByTestId("inicio").props.refreshControl.props.onRefresh;
    let hecho;
    await act(async () => {
      hecho = refresco();
    });
    // Mientras recarga, el carrusel sigue (sin «Cargando noticias…»).
    expect(screen.getByText("Aniversario")).toBeTruthy();
    expect(screen.queryByText("Cargando noticias…")).toBeNull();

    await act(async () => {
      recarga.rechazar(new Error("red"));
      await hecho;
    });
    expect(screen.getByText("Aniversario")).toBeTruthy();
    expect(screen.getByText(/No se pudieron actualizar las noticias/)).toBeTruthy();
  });

  it("al cambiar de empresa vuelve a pedir el perfil y las noticias", async () => {
    const { rerender } = await render(<Inicio />);
    await screen.findByText("No hay noticias publicadas por ahora.");

    mockSesion.versionEmpresa = 1;
    await rerender(<Inicio />);

    await waitFor(() => expect(inicioService.noticias).toHaveBeenCalledTimes(2));
    expect(inicioService.misDatos).toHaveBeenCalledTimes(2);
  });
});

describe("carrusel de noticias (WCAG 2.2.2)", () => {
  async function montarCarrusel(noticias = NOTICIAS) {
    const resultado = await render(<CarruselNoticias noticias={noticias} segundos={6} />);
    await fireEvent(screen.getByTestId("carrusel-noticias"), "layout", {
      nativeEvent: { layout: { width: 320, height: 300 } },
    });
    return resultado;
  }

  it("se puede pausar y reanudar con un botón visible", async () => {
    await montarCarrusel();
    await fireEvent.press(screen.getByRole("button", { name: "Pausar el carrusel" }));
    expect(screen.getByRole("button", { name: "Reanudar el carrusel" })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reanudar el carrusel" }));
    expect(screen.getByRole("button", { name: "Pausar el carrusel" })).toBeTruthy();
  });

  it("las flechas lo pausan y, en iOS, anuncian la posición", async () => {
    const os = Platform.OS;
    Platform.OS = "ios";
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await montarCarrusel();

    await fireEvent.press(screen.getByRole("button", { name: "Noticia siguiente" }));

    expect(screen.getByText("Noticia 2 de 2")).toBeTruthy();
    expect(screen.getByText("Capacitación")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reanudar el carrusel" })).toBeTruthy();
    expect(anuncio).toHaveBeenCalledWith("Noticia 2 de 2");
    Platform.OS = os;
  });

  it("la etiqueta de la imagen es su texto alternativo, sin repetir el título", async () => {
    await montarCarrusel();
    expect(screen.getByLabelText("Equipo en la oficina")).toBeTruthy();
    expect(screen.queryByLabelText(/Aniversario/)).toBeNull();
  });

  it("solo la diapositiva visible es accesible", async () => {
    await montarCarrusel();
    expect(screen.getByTestId("diapositiva-1").props.importantForAccessibility).toBe("auto");
    expect(screen.getByTestId("diapositiva-2", { includeHiddenElements: true }).props.accessibilityElementsHidden).toBe(true);
    // La segunda, sin texto alternativo, no se anuncia mientras no se ve.
    expect(screen.queryByLabelText("Imagen de la noticia")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Noticia siguiente" }));
    expect(screen.getByLabelText("Imagen de la noticia")).toBeTruthy();
    expect(screen.queryByLabelText("Equipo en la oficina")).toBeNull();
  });

  it("si la imagen no carga, lo dice en su lugar", async () => {
    await montarCarrusel();
    await fireEvent(screen.getByTestId("imagen-noticia-1"), "error");
    expect(screen.getByText("No se pudo cargar la imagen.")).toBeTruthy();
  });

  it("vuelve a la primera cuando cambian las noticias", async () => {
    const { rerender } = await montarCarrusel();
    await fireEvent.press(screen.getByRole("button", { name: "Noticia siguiente" }));
    expect(screen.getByText("Noticia 2 de 2")).toBeTruthy();

    await rerender(
      <CarruselNoticias noticias={[{ id: 3, titulo: "Nueva" }, { id: 4, titulo: "Otra" }]} segundos={6} />,
    );
    expect(screen.getByText("Noticia 1 de 2")).toBeTruthy();
    expect(screen.getByText("Nueva")).toBeTruthy();
  });

  it("con menos movimiento pedido no se mueve solo ni ofrece pausa", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    await montarCarrusel();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Pausar el carrusel" })).toBeNull());
  });
});

describe("contador de no leídas", () => {
  function Numero() {
    const { noLeidas } = useContador();
    return <Text>{`no leídas: ${noLeidas}`}</Text>;
  }

  it("lee el resumen y lo vuelve a leer al cambiar de empresa", async () => {
    notificacionesService.resumen.mockResolvedValue({ no_leidas: 3, recientes: [] });
    const { rerender } = await render(
      <ContadorProvider>
        <Numero />
      </ContadorProvider>,
    );
    expect(await screen.findByText("no leídas: 3")).toBeTruthy();
    expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(3);

    notificacionesService.resumen.mockResolvedValue({ no_leidas: 0, recientes: [] });
    mockSesion.versionEmpresa = 1;
    await rerender(
      <ContadorProvider>
        <Numero />
      </ContadorProvider>,
    );
    expect(await screen.findByText("no leídas: 0")).toBeTruthy();
    expect(notificacionesService.resumen).toHaveBeenCalledTimes(2);
  });
});

describe("Inicio: «Para hoy» y los accesos (auditoría UX, H-09)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function conPendientes({ porAprobar = 0, mensajes = 0, avisos = 0 }) {
    jest.spyOn(ResumenPermisos, "useResumenPermisos").mockReturnValue({ porAprobar, puedeSolicitar: true, cargado: true });
    jest.spyOn(ChatContext, "useChat").mockReturnValue({ totalNoLeidos: mensajes });
    jest.spyOn(ContadorContext, "useContador").mockReturnValue({ noLeidas: avisos, recargar: jest.fn() });
  }

  it("N-15: los avisos del chat no se cuentan dos veces", async () => {
    // 4 avisos en la campana, 2 de ellos de conversaciones con mensajes sin leer.
    expect(avisosDeOtrosModulos(4, { 5: 3, 7: 1 })).toBe(2);
    expect(avisosDeOtrosModulos(1, { 5: 3, 7: 1 })).toBe(0);
    expect(avisosDeOtrosModulos(3, undefined)).toBe(3);

    jest.spyOn(ResumenPermisos, "useResumenPermisos").mockReturnValue({ porAprobar: 0, puedeSolicitar: true, cargado: true });
    jest.spyOn(ChatContext, "useChat").mockReturnValue({ totalNoLeidos: 4, noLeidos: { 5: 3, 7: 1 } });
    jest.spyOn(ContadorContext, "useContador").mockReturnValue({ noLeidas: 3, recargar: jest.fn() });
    await render(<Inicio />);
    expect(await screen.findByRole("button", { name: "4 mensajes sin leer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "1 aviso de otros módulos" })).toBeTruthy();
  });

  it("un encabezado de accesos sin accesos debajo no se pinta", async () => {
    conPendientes({});
    const originales = [...ACCESOS];
    try {
      // Sin ningún acceso en la app.
      ACCESOS.splice(0, ACCESOS.length, ...originales.filter((a) => !a.rutaApp));
      await render(<Inicio />);
      await screen.findByText("No hay noticias publicadas por ahora.");
      expect(screen.queryByRole("header", { name: "En la app" })).toBeNull();
      expect(screen.getByRole("header", { name: "En el navegador" })).toBeTruthy();
    } finally {
      ACCESOS.splice(0, ACCESOS.length, ...originales);
    }
  });

  it("pendientesDeHoy: solo lo que tiene algo, con el plural correcto", () => {
    expect(pendientesDeHoy({})).toEqual([]);
    expect(pendientesDeHoy({ porAprobar: 1, mensajes: 1, avisos: 1 }).map((p) => p.texto)).toEqual([
      "1 solicitud por aprobar",
      "1 mensaje sin leer",
      "1 aviso de otros módulos",
    ]);
    expect(pendientesDeHoy({ porAprobar: 3, avisos: 2 }).map((p) => p.texto)).toEqual([
      "3 solicitudes por aprobar",
      "2 avisos de otros módulos",
    ]);
  });

  it("sin nada pendiente, el bloque no aparece", async () => {
    conPendientes({});
    await render(<Inicio />);
    await screen.findByText("No hay noticias publicadas por ahora.");
    expect(screen.queryByTestId("para-hoy")).toBeNull();
  });

  it("muestra lo pendiente tras el saludo y cada fila lleva a su lugar", async () => {
    conPendientes({ porAprobar: 2, mensajes: 5, avisos: 1 });
    await render(<Inicio />);
    expect(await screen.findByRole("header", { name: "Para hoy" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "2 solicitudes por aprobar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "1 aviso de otros módulos" })).toBeTruthy();

    await fireEvent.press(screen.getByTestId("para-hoy-por-aprobar"));
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: "/permisos",
      params: { seccion: "por_aprobar", n: expect.any(String) },
    });
    await fireEvent.press(screen.getByRole("button", { name: "5 mensajes sin leer" }));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: "/chat", params: { n: expect.any(String) } });
    await fireEvent.press(screen.getByTestId("para-hoy-avisos"));
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: "/notificaciones", params: { n: expect.any(String) } });
  });

  it("separa los accesos «En la app» y «En el navegador»", async () => {
    conPendientes({});
    await render(<Inicio />);
    await screen.findByText("No hay noticias publicadas por ahora.");
    expect(screen.getByRole("header", { name: "En la app" })).toBeTruthy();
    expect(screen.getByRole("header", { name: "En el navegador" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Chat\. / })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Mi perfil\. .*Abrir en el navegador$/ })).toBeTruthy();
  });
});
