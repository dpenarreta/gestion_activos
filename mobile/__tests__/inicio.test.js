import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import * as Notifications from "expo-notifications";
import { AccessibilityInfo, Platform, Text } from "react-native";

import { inicioService, notificacionesService } from "../src/api/servicios";
import {
  ContadorProvider,
  useContador,
} from "../src/notificaciones/ContadorContext";
import { CarruselNoticias } from "../src/pantallas/CarruselNoticias";
import * as ContadorContext from "../src/notificaciones/ContadorContext";
import {
  accesosPara,
  ACCESOS,
  Inicio,
  TEXTO_SIN_CARGO,
} from "../src/pantallas/Inicio";
import {
  avisosParaHoy,
  etiquetaDeAviso,
  MAXIMO_PARA_HOY,
  textoAvisosPorRevisar,
} from "../src/pantallas/ParaHoy";
import { coloresClarosEn, olvidarApariencia, renderEnOscuro } from "./utilidades/modoOscuro";

const mockRouter = { push: jest.fn(), dismissTo: jest.fn() };
// `mockFoco` guarda el último efecto de foco: llamarlo es volver al Inicio.
const mockFoco = { efecto: null };
jest.mock("expo-router", () => {
  const React = require("react");
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (efecto) => {
      mockFoco.efecto = efecto;
      React.useEffect(efecto, [efecto]);
    },
  };
});

const mockSesion = {
  usuario: { username: "ana", first_name: "Ana", permissions: [] },
  empresaActiva: { id: 1 },
  versionEmpresa: 0,
};
jest.mock("../src/sesion/SesionContext", () => ({
  useSesion: () => mockSesion,
}));

// El calendario tiene sus propias pruebas (calendarioInicio.test.js).
jest.mock("../src/pantallas/CalendarioInicio", () => {
  const { Text } = require("react-native");
  return {
    CalendarioInicio: ({ recarga }) => (
      <Text testID="calendario-inicio">{`recarga ${recarga}`}</Text>
    ),
  };
});

jest.mock("../src/api/servicios", () => ({
  inicioService: {
    misDatos: jest.fn(),
    noticias: jest.fn(),
    carrusel: jest.fn(async () => ({ segundos: 6 })),
    calendario: jest.fn(async () => []),
    rutaImagenNoticia: (id) =>
      `https://api/organizacion/noticias/${id}/imagen/`,
  },
  notificacionesService: {
    resumen: jest.fn(),
    listar: jest.fn(),
    leer: jest.fn(),
  },
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
  {
    id: 1,
    titulo: "Aniversario",
    descripcion: "Celebramos 20 años",
    texto_alternativo: "Equipo en la oficina",
  },
  { id: 2, titulo: "Capacitación", descripcion: "", texto_alternativo: "" },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockSesion.versionEmpresa = 0;
  inicioService.noticias.mockResolvedValue([]);
  inicioService.misDatos.mockResolvedValue({ nombres: "Ana", cargo: null });
  // Sin avisos sin leer, salvo que la prueba diga otra cosa.
  notificacionesService.listar.mockResolvedValue({
    count: 0,
    next: null,
    results: [],
  });
  notificacionesService.leer.mockResolvedValue({});
});

describe("Inicio: el cargo", () => {
  it("mientras carga no dice que no tiene cargo", async () => {
    const perfil = pendiente();
    inicioService.misDatos.mockReturnValue(perfil.promesa);
    await render(<Inicio />);

    expect(screen.getByText("Hola, Ana")).toBeTruthy();
    expect(
      screen.queryByText(new RegExp(TEXTO_SIN_CARGO.slice(0, 20))),
    ).toBeNull();

    await act(async () =>
      perfil.resolver({ cargo: { nombre: "Analista de cartera" } }),
    );
    expect(await screen.findByText("Analista de cartera.")).toBeTruthy();
  });

  it("si falla, tampoco lo dice", async () => {
    inicioService.misDatos.mockRejectedValue(new Error("500"));
    await render(<Inicio />);
    await screen.findByText("No hay noticias publicadas por ahora.");

    expect(
      screen.queryByText(new RegExp(TEXTO_SIN_CARGO.slice(0, 20))),
    ).toBeNull();
  });

  it("si cargó y no tiene cargo, lo dice con el enlace a Mi perfil", async () => {
    await render(<Inicio />);
    expect(
      await screen.findByText(new RegExp(TEXTO_SIN_CARGO.slice(0, 20))),
    ).toBeTruthy();
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
    expect(
      await screen.findByText("No hay noticias publicadas por ahora."),
    ).toBeTruthy();
  });

  it("si fallan ofrece «Reintentar»", async () => {
    inicioService.noticias.mockRejectedValueOnce(new Error("red"));
    await render(<Inicio />);

    expect(
      await screen.findByText("No se pudieron cargar las noticias."),
    ).toBeTruthy();
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
    const refresco =
      screen.getByTestId("inicio").props.refreshControl.props.onRefresh;
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
    expect(
      screen.getByText(/No se pudieron actualizar las noticias/),
    ).toBeTruthy();
    // El calendario va en su pestaña y también se recarga.
    expect(screen.queryByTestId("calendario-inicio")).toBeNull();
    await fireEvent.press(
      screen.getByRole("tab", { name: "Calendario de eventos" }),
    );
    expect(screen.getByTestId("calendario-inicio")).toHaveTextContent(
      "recarga 1",
    );
    expect(screen.queryByText("Aniversario")).toBeNull();
    await fireEvent.press(
      screen.getByRole("tab", { name: "Noticias y eventos" }),
    );
    expect(screen.getByText("Aniversario")).toBeTruthy();
  });

  it("pone un punto en «Calendario de eventos» si hoy hay alguna fecha", async () => {
    inicioService.calendario.mockResolvedValueOnce([
      { id: 1, titulo: "Cierre", tipo: "evento", fecha: "2026-11-16" },
    ]);
    await render(<Inicio />);
    expect(await screen.findByTestId("inicio-punto-calendario")).toBeTruthy();
    expect(
      screen.getByRole("tab", {
        name: "Calendario de eventos, hay fechas hoy",
      }),
    ).toBeTruthy();
    const [desde, hasta] = inicioService.calendario.mock.calls[0];
    expect(desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(hasta).toBe(desde);
  });

  it("sin fechas hoy no hay punto", async () => {
    await render(<Inicio />);
    await screen.findByText("No hay noticias publicadas por ahora.");
    await waitFor(() => expect(inicioService.calendario).toHaveBeenCalled());
    expect(screen.queryByTestId("inicio-punto-calendario")).toBeNull();
  });

  it("al cambiar de empresa vuelve a pedir el perfil y las noticias", async () => {
    const { rerender } = await render(<Inicio />);
    await screen.findByText("No hay noticias publicadas por ahora.");

    mockSesion.versionEmpresa = 1;
    await rerender(<Inicio />);

    await waitFor(() =>
      expect(inicioService.noticias).toHaveBeenCalledTimes(2),
    );
    expect(inicioService.misDatos).toHaveBeenCalledTimes(2);
  });
});

describe("carrusel de noticias (WCAG 2.2.2)", () => {
  async function montarCarrusel(noticias = NOTICIAS) {
    const resultado = await render(
      <CarruselNoticias noticias={noticias} segundos={6} />,
    );
    await fireEvent(screen.getByTestId("carrusel-noticias"), "layout", {
      nativeEvent: { layout: { width: 320, height: 300 } },
    });
    return resultado;
  }

  it("se puede pausar y reanudar con un botón visible", async () => {
    await montarCarrusel();
    await fireEvent.press(
      screen.getByRole("button", { name: "Pausar el carrusel" }),
    );
    expect(
      screen.getByRole("button", { name: "Reanudar el carrusel" }),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Reanudar el carrusel" }),
    );
    expect(
      screen.getByRole("button", { name: "Pausar el carrusel" }),
    ).toBeTruthy();
  });

  it("las flechas lo pausan y, en iOS, anuncian la posición", async () => {
    const os = Platform.OS;
    Platform.OS = "ios";
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await montarCarrusel();

    await fireEvent.press(
      screen.getByRole("button", { name: "Noticia siguiente" }),
    );

    expect(screen.getByText("Noticia 2 de 2")).toBeTruthy();
    expect(screen.getByText("Capacitación")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reanudar el carrusel" }),
    ).toBeTruthy();
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
    expect(
      screen.getByTestId("diapositiva-1").props.importantForAccessibility,
    ).toBe("auto");
    expect(
      screen.getByTestId("diapositiva-2", { includeHiddenElements: true }).props
        .accessibilityElementsHidden,
    ).toBe(true);
    // La segunda, sin texto alternativo, no se anuncia mientras no se ve.
    expect(screen.queryByLabelText("Imagen de la noticia")).toBeNull();

    await fireEvent.press(
      screen.getByRole("button", { name: "Noticia siguiente" }),
    );
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
    await fireEvent.press(
      screen.getByRole("button", { name: "Noticia siguiente" }),
    );
    expect(screen.getByText("Noticia 2 de 2")).toBeTruthy();

    await rerender(
      <CarruselNoticias
        noticias={[
          { id: 3, titulo: "Nueva" },
          { id: 4, titulo: "Otra" },
        ]}
        segundos={6}
      />,
    );
    expect(screen.getByText("Noticia 1 de 2")).toBeTruthy();
    expect(screen.getByText("Nueva")).toBeTruthy();
  });

  it("con menos movimiento pedido no se mueve solo ni ofrece pausa", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true);
    await montarCarrusel();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Pausar el carrusel" }),
      ).toBeNull(),
    );
  });
});

describe("contador de no leídas", () => {
  function Numero() {
    const { noLeidas } = useContador();
    return <Text>{`no leídas: ${noLeidas}`}</Text>;
  }

  it("lee el resumen y lo vuelve a leer al cambiar de empresa", async () => {
    notificacionesService.resumen.mockResolvedValue({
      no_leidas: 3,
      recientes: [],
    });
    const { rerender } = await render(
      <ContadorProvider>
        <Numero />
      </ContadorProvider>,
    );
    expect(await screen.findByText("no leídas: 3")).toBeTruthy();
    expect(Notifications.setBadgeCountAsync).toHaveBeenCalledWith(3);

    notificacionesService.resumen.mockResolvedValue({
      no_leidas: 0,
      recientes: [],
    });
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

describe("Inicio: los accesos (auditoría UX, H-09)", () => {
  it("un encabezado de accesos sin accesos debajo no se pinta", async () => {
    const originales = [...ACCESOS];
    try {
      // Sin ningún acceso en la app.
      ACCESOS.splice(
        0,
        ACCESOS.length,
        ...originales.filter((a) => !a.rutaApp),
      );
      await render(<Inicio />);
      await screen.findByText("No hay noticias publicadas por ahora.");
      expect(screen.queryByRole("header", { name: "En la app" })).toBeNull();
      expect(
        screen.getByRole("header", { name: "En el navegador" }),
      ).toBeTruthy();
    } finally {
      ACCESOS.splice(0, ACCESOS.length, ...originales);
    }
  });

  it("US-014: «Mesa de ayuda» está en la app (sustituye «Soporte TI») y abre la sección", async () => {
    await render(<Inicio />);
    await screen.findByText("No hay noticias publicadas por ahora.");
    expect(screen.queryByText("Soporte TI")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: /^Mesa de ayuda\. / }),
    );
    expect(mockRouter.push).toHaveBeenLastCalledWith({
      pathname: "/soporte",
      params: { n: expect.any(String) },
    });
    expect(
      accesosPara(["soporte.atender"]).find((a) => a.to === "/admin/ayuda")
        .texto,
    ).toMatch(/^Su bandeja/);
    expect(accesosPara([]).find((a) => a.to === "/admin/ayuda").texto).toBe(
      "Seguir sus tickets",
    );
  });

  it("separa los accesos «En la app» y «En el navegador»", async () => {
    await render(<Inicio />);
    await screen.findByText("No hay noticias publicadas por ahora.");
    expect(screen.getByRole("header", { name: "En la app" })).toBeTruthy();
    expect(
      screen.getByRole("header", { name: "En el navegador" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Chat\. / })).toBeTruthy();
    expect(
      screen.getByRole("link", {
        name: /^Códigos de conducta\. .*Abrir en el navegador$/,
      }),
    ).toBeTruthy();
    // 16/11/2026: «Mi perfil» ya se ve en la app (solo lectura).
    expect(screen.getByRole("button", { name: /^Mi perfil\. / })).toBeTruthy();
  });
});

describe("US-026: modo oscuro", () => {
  afterEach(olvidarApariencia);

  it("Inicio en oscuro: tarjetas, accesos y calendario sin colores claros fijos (CA-5)", async () => {
    const vista = await renderEnOscuro(<Inicio />);
    await screen.findByText("No hay noticias publicadas por ahora.");
    expect(coloresClarosEn(vista.toJSON())).toEqual([]);
  });
});

describe("US-027: «Para hoy» contraído con los avisos sin leer", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    olvidarApariencia();
  });

  /** Con la forma real de `NotificacionSerializer`. */
  function aviso(id, campos = {}) {
    return {
      id,
      modulo: "dashboards",
      modulo_nombre: "Dashboards",
      icono: "kanban",
      tipo: "dashboards.compartido",
      titulo: `Aviso ${id}`,
      resumen: `Resumen del aviso ${id}`,
      enlace: "/admin/dashboards/3",
      leida: false,
      leida_en: null,
      // Cuanto mayor el ID, más reciente.
      created_at: new Date(Date.now() - (100 - id) * 60_000).toISOString(),
      ...campos,
    };
  }

  function conAvisos(avisos, count = avisos.length) {
    notificacionesService.listar.mockResolvedValue({
      count,
      next: null,
      results: avisos,
    });
  }

  function encabezado(nombre) {
    return screen.findByRole("button", { name: `Para hoy. ${nombre}` });
  }

  it("CA-1: abre contraído, con el plural, un chevron y el estado «expanded»", async () => {
    conAvisos([aviso(1), aviso(2), aviso(3)]);
    await render(<Inicio />);
    const boton = await encabezado("3 avisos por revisar");
    expect(boton.props.accessibilityState).toEqual({ expanded: false });
    expect(screen.getByTestId("para-hoy-resumen")).toHaveTextContent(
      "3 avisos por revisar",
    );
    expect(screen.queryByTestId("para-hoy-lista")).toBeNull();
    expect(screen.queryByText("Aviso 1")).toBeNull();
    // Pide solo las no leídas, como el filtro de la campana, y solo las
    // que muestra (QA, 17/11/2026: `page_size=10`).
    expect(notificacionesService.listar).toHaveBeenCalledWith({
      pagina: 1,
      soloNoLeidas: true,
      tamano: 10,
    });
  });

  it("CA-1: en singular, «1 aviso por revisar»", async () => {
    conAvisos([aviso(1)]);
    await render(<Inicio />);
    expect(await encabezado("1 aviso por revisar")).toBeTruthy();
    expect(textoAvisosPorRevisar(1)).toBe("1 aviso por revisar");
    expect(textoAvisosPorRevisar(2)).toBe("2 avisos por revisar");
  });

  it("CA-2: sin avisos sin leer, el bloque no aparece", async () => {
    await render(<Inicio />);
    await screen.findByText("No hay noticias publicadas por ahora.");
    await waitFor(() =>
      expect(notificacionesService.listar).toHaveBeenCalled(),
    );
    expect(screen.queryByTestId("para-hoy")).toBeNull();
    expect(screen.queryByText("Para hoy")).toBeNull();
  });

  it("CA-3: al expandirse lista cada aviso (módulo, título, resumen y fecha), los más recientes primero, y se contrae", async () => {
    conAvisos([
      aviso(1),
      aviso(3, {
        modulo: "soporte",
        modulo_nombre: "Mesa de ayuda",
        icono: "headset",
      }),
      aviso(2),
    ]);
    await render(<Inicio />);
    await fireEvent.press(await encabezado("3 avisos por revisar"));

    expect(
      screen.getByRole("button", { name: "Para hoy. 3 avisos por revisar" })
        .props.accessibilityState,
    ).toEqual({ expanded: true });
    const filas = screen
      .getAllByRole("button", { name: /^(Dashboards|Mesa de ayuda)\. Aviso / })
      .map((f) => f.props.testID);
    expect(filas).toEqual([
      "para-hoy-aviso-3",
      "para-hoy-aviso-2",
      "para-hoy-aviso-1",
    ]);
    // CA-7: el nombre accesible completo de cada fila.
    expect(
      screen.getByRole("button", {
        name: "Mesa de ayuda. Aviso 3. Resumen del aviso 3",
      }),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("para-hoy-aviso-3")).getByText("Mesa de ayuda"),
    ).toBeTruthy();
    expect(screen.getByText("Resumen del aviso 3")).toBeTruthy();
    expect(screen.getByTestId("para-hoy-llego-3")).toHaveTextContent(
      /^hace \d+ (min|h)$/,
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Para hoy. 3 avisos por revisar" }),
    );
    expect(screen.queryByTestId("para-hoy-lista")).toBeNull();
  });

  it("CA-3: muestra hasta 10 y «Ver todos los avisos» abre Notificaciones", async () => {
    const doce = Array.from({ length: 12 }, (_, i) => aviso(i + 1));
    conAvisos(doce, 25);
    await render(<Inicio />);
    // El total es el de la campana (`count`), aunque se listen 10.
    await fireEvent.press(await encabezado("25 avisos por revisar"));

    expect(MAXIMO_PARA_HOY).toBe(10);
    const filas = screen.getAllByRole("button", { name: /^Dashboards\. / });
    expect(filas).toHaveLength(10);
    expect(filas[0].props.testID).toBe("para-hoy-aviso-12");
    expect(screen.queryByTestId("para-hoy-aviso-2")).toBeNull();

    await fireEvent.press(
      screen.getByRole("button", { name: "Ver todos los avisos" }),
    );
    expect(mockRouter.push).toHaveBeenLastCalledWith("/notificaciones");
  });

  it("CA-4: tocar un aviso de un módulo de la app hace lo mismo que la campana: lo marca leído y vuelve al módulo", async () => {
    const recargar = jest.fn(async () => {});
    jest
      .spyOn(ContadorContext, "useContador")
      .mockReturnValue({ noLeidas: 2, recargar });
    conAvisos([
      aviso(1),
      aviso(2, {
        modulo: "soporte",
        modulo_nombre: "Mesa de ayuda",
        enlace: "/admin/aprobaciones",
      }),
    ]);
    await render(<Inicio />);
    await fireEvent.press(await encabezado("2 avisos por revisar"));
    await fireEvent.press(
      screen.getByRole("button", { name: /^Mesa de ayuda\. Aviso 2/ }),
    );

    expect(notificacionesService.leer).toHaveBeenCalledWith(2);
    expect(mockRouter.dismissTo).toHaveBeenCalledWith(
      expect.stringMatching(/^\/soporte\?vista=aprobaciones&n=\d+$/),
    );
    await waitFor(() => expect(recargar).toHaveBeenCalled());
    // Sale de la lista y el contador baja enseguida.
    expect(screen.queryByTestId("para-hoy-aviso-2")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Para hoy. 1 aviso por revisar" }),
    ).toBeTruthy();
  });

  it("CA-4: un aviso de un módulo fuera de la app abre su detalle, que es quien lo marca leído; al volver al Inicio se actualiza", async () => {
    conAvisos([aviso(1), aviso(2)]);
    await render(<Inicio />);
    await fireEvent.press(await encabezado("2 avisos por revisar"));
    await fireEvent.press(
      screen.getByRole("button", { name: /^Dashboards\. Aviso 1/ }),
    );
    expect(mockRouter.push).toHaveBeenLastCalledWith("/notificacion/1");
    expect(notificacionesService.leer).not.toHaveBeenCalled();

    // Al volver, el foco recarga: el detalle ya la marcó leída.
    conAvisos([aviso(2)]);
    const llamadas = notificacionesService.listar.mock.calls.length;
    await act(async () => {
      mockFoco.efecto();
    });
    expect(notificacionesService.listar.mock.calls.length).toBe(llamadas + 1);
    expect(await encabezado("1 aviso por revisar")).toBeTruthy();
  });

  it("CA-5: se recarga al deslizar para actualizar", async () => {
    conAvisos([aviso(1)]);
    await render(<Inicio />);
    await encabezado("1 aviso por revisar");
    const llamadas = notificacionesService.listar.mock.calls.length;

    conAvisos([aviso(1), aviso(2)]);
    await act(async () => {
      await screen.getByTestId("inicio").props.refreshControl.props.onRefresh();
    });
    expect(notificacionesService.listar.mock.calls.length).toBe(llamadas + 1);
    expect(await encabezado("2 avisos por revisar")).toBeTruthy();
  });

  it("CA-5: si falla con avisos en la campana, no rompe el Inicio y ofrece «Reintentar» dentro del bloque expandido", async () => {
    jest
      .spyOn(ContadorContext, "useContador")
      .mockReturnValue({ noLeidas: 1, recargar: jest.fn() });
    notificacionesService.listar.mockRejectedValueOnce(new Error("red"));
    await render(<Inicio />);
    await screen.findByText("No hay noticias publicadas por ahora.");
    const boton = await encabezado("1 aviso por revisar");
    // Contraído no se ve el error ni el botón.
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();

    await fireEvent.press(boton);
    conAvisos([aviso(1)]);
    await fireEvent.press(screen.getByRole("button", { name: "Reintentar" }));
    expect(await encabezado("1 aviso por revisar")).toBeTruthy();
    // Sigue expandido, ahora con el aviso.
    expect(
      screen.getByRole("button", { name: /^Dashboards\. Aviso 1/ }),
    ).toBeTruthy();
  });

  it("CA-5: si falla una recarga con avisos a la vista, los conserva y lo dice", async () => {
    conAvisos([aviso(1)]);
    await render(<Inicio />);
    await fireEvent.press(await encabezado("1 aviso por revisar"));
    notificacionesService.listar.mockRejectedValueOnce(new Error("red"));
    await act(async () => {
      mockFoco.efecto();
    });
    expect(
      await screen.findByText(/No se pudieron actualizar los avisos/),
    ).toBeTruthy();
    expect(screen.getByTestId("para-hoy-aviso-1")).toBeTruthy();
  });

  it("CA-2 (QA): con 0 avisos en la campana y la carga fallida, el bloque no aparece", async () => {
    notificacionesService.listar.mockRejectedValueOnce(new Error("red"));
    await render(<Inicio />);
    await screen.findByText("No hay noticias publicadas por ahora.");
    await waitFor(() =>
      expect(screen.queryByTestId("para-hoy-reservado", { includeHiddenElements: true })).toBeNull(),
    );
    expect(screen.queryByTestId("para-hoy")).toBeNull();
    expect(screen.queryByText("No se pudieron cargar los avisos.")).toBeNull();
  });

  it("O-1: con el contador en 0 reserva el alto del encabezado hasta que llega la lista; si es 0, desaparece", async () => {
    const lista = pendiente();
    notificacionesService.listar.mockReturnValueOnce(lista.promesa);
    await render(<Inicio />);
    const reservado = await screen.findByTestId("para-hoy-reservado", { includeHiddenElements: true });
    // Invisible y fuera del lector de pantalla.
    expect(reservado.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(reservado.props.accessibilityElementsHidden).toBe(true);
    expect(screen.queryByRole("button", { name: /^Para hoy/ })).toBeNull();
    await act(async () => {
      lista.resolver({ count: 0, next: null, results: [] });
    });
    expect(screen.queryByTestId("para-hoy-reservado", { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId("para-hoy")).toBeNull();
  });

  it("O-1: si la lista trae avisos, el espacio reservado pasa a ser el bloque", async () => {
    const lista = pendiente();
    notificacionesService.listar.mockReturnValueOnce(lista.promesa);
    await render(<Inicio />);
    await screen.findByTestId("para-hoy-reservado", { includeHiddenElements: true });
    await act(async () => {
      lista.resolver({ count: 1, next: null, results: [aviso(1)] });
    });
    expect(await encabezado("1 aviso por revisar")).toBeTruthy();
    expect(screen.queryByTestId("para-hoy-reservado", { includeHiddenElements: true })).toBeNull();
  });

  it("O-2: al cambiar de empresa vacía los avisos antes de recargar; si la recarga falla no quedan los de la anterior", async () => {
    conAvisos([aviso(1)]);
    const vista = await render(<Inicio />);
    await fireEvent.press(await encabezado("1 aviso por revisar"));
    expect(screen.getByTestId("para-hoy-aviso-1")).toBeTruthy();

    notificacionesService.listar.mockRejectedValueOnce(new Error("red"));
    mockSesion.versionEmpresa = 1;
    await vista.rerender(<Inicio />);
    await act(async () => {});
    expect(screen.queryByTestId("para-hoy-aviso-1")).toBeNull();
    expect(screen.queryByTestId("para-hoy")).toBeNull();
  });

  it("al cambiar de empresa los avisos se piden una sola vez aunque cambie también el contador", async () => {
    const contador = { noLeidas: 1, recargar: jest.fn() };
    jest.spyOn(ContadorContext, "useContador").mockImplementation(() => contador);
    conAvisos([aviso(1)]);
    const vista = await render(<Inicio />);
    await encabezado("1 aviso por revisar");
    const llamadas = notificacionesService.listar.mock.calls.length;

    const lista = pendiente();
    notificacionesService.listar.mockReturnValueOnce(lista.promesa);
    mockSesion.versionEmpresa = 1;
    await vista.rerender(<Inicio />);
    // El contador de la otra empresa llega mientras la lista sigue en vuelo.
    contador.noLeidas = 3;
    await vista.rerender(<Inicio />);
    await act(async () => {
      lista.resolver({ count: 3, next: null, results: [aviso(1), aviso(2), aviso(3)] });
    });
    expect(await encabezado("3 avisos por revisar")).toBeTruthy();
    expect(notificacionesService.listar.mock.calls.length).toBe(llamadas + 1);
  });

  it("al marcar leído, una carga que estaba en vuelo no vuelve a mostrar el aviso", async () => {
    const recargar = jest.fn(async () => {});
    jest
      .spyOn(ContadorContext, "useContador")
      .mockReturnValue({ noLeidas: 2, recargar });
    conAvisos([
      aviso(1),
      aviso(2, { modulo: "soporte", modulo_nombre: "Mesa de ayuda", enlace: "/admin/aprobaciones" }),
    ]);
    await render(<Inicio />);
    await fireEvent.press(await encabezado("2 avisos por revisar"));

    // Una recarga sale antes de tocar el aviso y responde después, con el
    // aviso todavía sin leer.
    const enVuelo = pendiente();
    notificacionesService.listar.mockReturnValueOnce(enVuelo.promesa);
    await act(async () => {
      mockFoco.efecto();
    });
    await fireEvent.press(
      screen.getByRole("button", { name: /^Mesa de ayuda\. Aviso 2/ }),
    );
    expect(screen.queryByTestId("para-hoy-aviso-2")).toBeNull();
    await act(async () => {
      enVuelo.resolver({
        count: 2,
        next: null,
        results: [aviso(1), aviso(2, { modulo: "soporte", modulo_nombre: "Mesa de ayuda" })],
      });
    });
    expect(screen.queryByTestId("para-hoy-aviso-2")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Para hoy. 1 aviso por revisar" }),
    ).toBeTruthy();
  });

  it("al deslizar para actualizar, recarga también el contador de la campana", async () => {
    const recargar = jest.fn(async () => {});
    jest
      .spyOn(ContadorContext, "useContador")
      .mockReturnValue({ noLeidas: 0, recargar });
    await render(<Inicio />);
    await screen.findByText("No hay noticias publicadas por ahora.");
    await act(async () => {
      await screen.getByTestId("inicio").props.refreshControl.props.onRefresh();
    });
    expect(recargar).toHaveBeenCalled();
  });

  it("CA-6: ya no muestra las líneas agrupadas de antes", async () => {
    conAvisos([aviso(1)]);
    await render(<Inicio />);
    await fireEvent.press(await encabezado("1 aviso por revisar"));
    expect(screen.queryByText(/de otros módulos/)).toBeNull();
    expect(screen.queryByText(/por aprobar$/)).toBeNull();
    expect(screen.queryByText(/sin leer$/)).toBeNull();
  });

  it("avisosParaHoy y etiquetaDeAviso", () => {
    const viejo = aviso(1);
    const nuevo = aviso(5);
    const leido = aviso(9, { leida: true });
    expect(avisosParaHoy([viejo, leido, nuevo]).map((n) => n.id)).toEqual([
      5, 1,
    ]);
    expect(avisosParaHoy(undefined)).toEqual([]);
    expect(etiquetaDeAviso(aviso(4, { resumen: "" }))).toBe(
      "Dashboards. Aviso 4",
    );
  });

  it("CA-7: en oscuro, contraído y expandido, sin colores claros fijos", async () => {
    conAvisos([aviso(1), aviso(2, { modulo: "chat", modulo_nombre: "Chat" })]);
    const vista = await renderEnOscuro(<Inicio />);
    await encabezado("2 avisos por revisar");
    expect(coloresClarosEn(vista.toJSON())).toEqual([]);
    await fireEvent.press(
      screen.getByRole("button", { name: "Para hoy. 2 avisos por revisar" }),
    );
    expect(screen.getByTestId("para-hoy-aviso-2")).toBeTruthy();
    expect(coloresClarosEn(vista.toJSON())).toEqual([]);
  });
});
