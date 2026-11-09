import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Derechos sobre datos personales (LOPDP): «Mis derechos» en el perfil del
 * titular (descarga, nueva solicitud con sus validaciones, lista con
 * historial), la bandeja de quien atiende (permisos, filtros, búsqueda en
 * vivo), el detalle (cambio de estado con respuesta obligatoria y 409, y la
 * descarga del titular solo si procede) y la entrada del menú con su
 * insignia. Los servicios van simulados.
 */

// --- Datos ------------------------------------------------------------------

const ME_TITULAR = {
  puede_ver_bandeja: false,
  puede_atender: false,
  plazo_dias: 15,
  tipos: [],
  estados: [],
};
const ME_ATIENDE = {
  ...ME_TITULAR,
  puede_ver_bandeja: true,
  puede_atender: true,
};
const ME_SOLO_VE = { ...ME_TITULAR, puede_ver_bandeja: true };

function solicitud(extra = {}) {
  return {
    id: 12,
    numero: "LOPDP-00012",
    tipo: "RECTIFICACION",
    tipo_label: "Corrección de datos",
    descripcion: "Mi segundo apellido está mal escrito.",
    estado: "EN_PROCESO",
    estado_label: "En proceso",
    creada_en: "2026-11-09T10:15:00-05:00",
    fecha_limite: "2026-11-24",
    plazo_dias: 15,
    dias_restantes: 15,
    vencida: false,
    respuesta: "",
    resuelta_en: null,
    ...extra,
  };
}

const RESUELTA = solicitud({
  id: 5,
  numero: "LOPDP-00005",
  tipo: "ACCESO",
  descripcion: "",
  estado: "RESUELTA",
  estado_label: "Resuelta",
  dias_restantes: null,
  respuesta: "Le enviamos el detalle de sus datos.",
  resuelta_en: "2026-11-01T09:00:00-05:00",
});
const VENCIDA = solicitud({
  id: 3,
  numero: "LOPDP-00003",
  tipo: "ELIMINACION",
  estado: "PENDIENTE",
  estado_label: "Pendiente",
  fecha_limite: "2026-11-01",
  dias_restantes: -8,
  vencida: true,
});

const HISTORIAL = [
  {
    estado_anterior: null,
    estado_nuevo: "PENDIENTE",
    estado_nuevo_label: "Pendiente",
    respuesta: "",
    fecha: "2026-11-09T10:15:00-05:00",
  },
  {
    estado_anterior: "PENDIENTE",
    estado_nuevo: "EN_PROCESO",
    estado_nuevo_label: "En proceso",
    respuesta: "Lo estamos revisando.",
    fecha: "2026-11-10T08:00:00-05:00",
  },
];

const SECCIONES = {
  secciones: [
    {
      clave: "cuenta",
      titulo: "Cuenta",
      descripcion: "Usuario, nombres y correo",
      solo_el_titular: false,
    },
    {
      clave: "chat",
      titulo: "Chat",
      descripcion: "Mensajes que envió",
      solo_el_titular: true,
    },
  ],
  no_incluido: [{ que: "Rol de pagos", motivo: "Tiene su propia descarga" }],
};

const TITULAR = {
  id: 40,
  nombre: "Ana Pérez",
  usuario: "aperez",
  correo: "aperez@grupolaar.com",
};

function deBandeja(s, extra = {}) {
  return {
    ...s,
    titular: TITULAR,
    resuelta_por: null,
    importada_de_nexo: false,
    ...extra,
  };
}

function paginaDe(lista, totales = { abiertas: 2, vencidas: 1 }) {
  return {
    count: lista.length,
    next: null,
    previous: null,
    results: lista,
    totales,
  };
}

function errorApi(status, code, message, details = null) {
  return { response: { status, data: { error: { code, message, details } } } };
}

// --- Simulaciones -------------------------------------------------------------

const servicio = {};
function reiniciarServicio() {
  Object.assign(servicio, {
    yo: vi.fn().mockResolvedValue(ME_TITULAR),
    misSolicitudes: vi.fn().mockResolvedValue([solicitud(), RESUELTA, VENCIDA]),
    miSolicitud: vi
      .fn()
      .mockResolvedValue({ ...solicitud(), historial: HISTORIAL }),
    crearSolicitud: vi.fn(),
    secciones: vi.fn().mockResolvedValue(SECCIONES),
    descargarMisDatos: vi.fn().mockResolvedValue("mis-datos-aperez.xlsx"),
    bandeja: vi
      .fn()
      .mockResolvedValue(
        paginaDe([deBandeja(VENCIDA), deBandeja(solicitud())]),
      ),
    vencidas: vi.fn().mockResolvedValue(1),
    solicitud: vi.fn(),
    cambiarEstado: vi.fn(),
    descargarDatosDelTitular: vi
      .fn()
      .mockResolvedValue("mis-datos-aperez-LOPDP-00005.xlsx"),
  });
}
reiniciarServicio();

vi.mock("../src/api/privacidadService", async (importOriginal) => ({
  ...(await importOriginal()),
  privacidadService: servicio,
}));
// La pestaña «Mis datos» del perfil: no se prueba aquí.
vi.mock("../src/api/misDatosService", () => ({
  misDatosService: { obtener: () => new Promise(() => {}) },
}));
const usuario = { current: { id: 1, permissions: [] } };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: usuario.current,
    isAuthenticated: true,
    isInitializing: false,
  }),
}));

const { MisDatosPage } = await import("../src/pages/MisDatos/MisDatosPage");
// «Mis derechos» se carga bajo demanda: importado aquí, la primera prueba no
// espera la carga del módulo (con la suite completa tardaba más de 1 s).
await import("../src/pages/Privacidad/MisDerechos");
const { BandejaPrivacidad } =
  await import("../src/pages/Privacidad/BandejaPrivacidad");
const { DetalleSolicitudPrivacidad } =
  await import("../src/pages/Privacidad/DetalleSolicitudPrivacidad");
const { RequirePermission } =
  await import("../src/components/common/RequirePermission/RequirePermission");
const { PERMISOS_PRIVACIDAD } =
  await import("../src/pages/Privacidad/privacidadComunes");
const { getVisibleAdminMenu } =
  await import("../src/components/admin/AdminSidebar/staticAdminMenu");
const { sufijoDeInsignia, TEXTOS } =
  await import("../src/components/admin/AdminSidebar/AdminMenuItem");
const { moduloDeRuta } = await import("../src/modulos/modulos");
const { EVENTO_INSIGNIAS } = await import("../src/utils/insigniasDelMenu");

beforeEach(() => {
  reiniciarServicio();
  usuario.current = { id: 1, permissions: [] };
});

// --- El titular ---------------------------------------------------------------

function pintarPerfil(ruta = "/admin/perfil?seccion=mis-derechos") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/admin/perfil" element={<MisDatosPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Mi perfil: pestañas", () => {
  it("sin ?seccion abre «Mis datos»", () => {
    pintarPerfil("/admin/perfil");
    expect(screen.getByRole("tab", { name: /Mis datos/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(servicio.misSolicitudes).not.toHaveBeenCalled();
  });

  it("?seccion=mis-derechos (el enlace del aviso) abre «Mis derechos»", async () => {
    pintarPerfil();
    expect(screen.getByRole("tab", { name: /Mis derechos/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      await screen.findByRole(
        "heading",
        {
          name: /Sus derechos sobre sus datos personales/,
        },
        // La pestaña se carga bajo demanda: con la suite completa en
        // paralelo, la primera vez puede pasar del segundo.
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
  });
});

describe("Mis derechos: explicación y lista", () => {
  it("explica los derechos con el plazo del servidor", async () => {
    servicio.yo.mockResolvedValue({ ...ME_TITULAR, plazo_dias: 10 });
    pintarPerfil();
    expect(await screen.findByText("10 días")).toBeInTheDocument();
    const derechos = screen.getByRole("region", {
      name: /Sus derechos sobre sus datos personales/,
    });
    for (const nombre of [
      "Pedir acceso a mis datos",
      "Pedir corrección de mis datos",
      "Pedir eliminación de mis datos",
    ])
      expect(
        within(derechos).getByRole("button", { name: nombre }),
      ).toBeInTheDocument();
    // La explicación va como descripción del botón.
    expect(
      within(derechos).getByRole("button", {
        name: "Pedir corrección de mis datos",
      }),
    ).toHaveAccessibleDescription(/Corregir o completar un dato suyo/);
    expect(
      screen.getByText(/nada se borra automáticamente/i),
    ).toBeInTheDocument();
  });

  it("lista sus solicitudes con estado, plazo, vencida y respuesta en texto", async () => {
    pintarPerfil();
    const lista = await screen.findByRole("list", { name: "Sus solicitudes" });
    const items = within(lista).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    const abierta = items[0];
    expect(within(abierta).getByText("En proceso")).toBeInTheDocument();
    expect(within(abierta).getByText("24/11/2026")).toBeInTheDocument();
    expect(within(abierta).getByText(/quedan 15 días/)).toBeInTheDocument();
    expect(
      within(abierta).getByText(/Todavía no tiene respuesta/),
    ).toBeInTheDocument();
    const resuelta = items[1];
    expect(within(resuelta).getByText("Resuelta")).toBeInTheDocument();
    expect(
      within(resuelta).getByText("Le enviamos el detalle de sus datos."),
    ).toBeInTheDocument();
    expect(within(resuelta).getByText(/Respondida el/)).toBeInTheDocument();
    const vencida = items[2];
    expect(within(vencida).getByText("Vencida")).toBeInTheDocument();
    expect(within(vencida).getByText(/venció hace 8 días/)).toBeInTheDocument();
    // La eliminación aclara que la gestiona el equipo a mano.
    expect(
      within(vencida).getByText(/se conservan por obligación legal/),
    ).toBeInTheDocument();
  });

  it("el historial se pide al abrirlo", async () => {
    pintarPerfil();
    const boton = await screen.findByRole("button", {
      name: "Ver historial de LOPDP-00012",
    });
    expect(boton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(boton);
    expect(servicio.miSolicitud).toHaveBeenCalledWith(12);
    expect(
      await screen.findByText("Lo estamos revisando."),
    ).toBeInTheDocument();
    expect(screen.getByText("Solicitud recibida")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ocultar historial de LOPDP-00012" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("vacío: invita a hacer la primera, con un solo botón", async () => {
    servicio.misSolicitudes.mockResolvedValue([]);
    pintarPerfil();
    expect(
      await screen.findByText("Todavía no ha hecho ninguna solicitud."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Hacer una solicitud/ }),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Hacer una solicitud" }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Nueva solicitud sobre sus datos",
      }),
    ).toBeInTheDocument();
  });

  it("con solicitudes, «Mis solicitudes» va antes que los derechos; sin ellas, después", async () => {
    const { unmount } = pintarPerfil();
    const lista = await screen.findByRole("region", {
      name: "Mis solicitudes",
    });
    const derechos = screen.getByRole("region", {
      name: /Sus derechos sobre sus datos personales/,
    });
    expect(
      lista.compareDocumentPosition(derechos) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    unmount();

    servicio.misSolicitudes.mockResolvedValue([]);
    pintarPerfil();
    await screen.findByText("Todavía no ha hecho ninguna solicitud.");
    expect(
      screen
        .getByRole("region", { name: "Mis solicitudes" })
        .compareDocumentPosition(
          screen.getByRole("region", {
            name: /Sus derechos sobre sus datos personales/,
          }),
        ) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it("una tarjeta abre la solicitud con su tipo ya elegido", async () => {
    pintarPerfil();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Pedir corrección de mis datos",
      }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Nueva solicitud sobre sus datos",
    });
    const correccion = within(ventana).getByRole("radio", {
      name: /Corrección de mis datos/,
    });
    expect(correccion).toBeChecked();
    await waitFor(() => expect(correccion).toHaveFocus());
    // La corrección exige describirla, y la ayuda manda lo editable a «Mis datos».
    expect(
      within(ventana).getByRole("textbox", { name: /Descripción/ }),
    ).toHaveAttribute("aria-required", "true");
    expect(
      within(ventana).getByText(/puede corregirlo usted mismo/),
    ).toBeInTheDocument();
  });

  it("desde el aviso (&solicitud=<id>) enfoca esa solicitud y abre su historial", async () => {
    pintarPerfil("/admin/perfil?seccion=mis-derechos&solicitud=12");
    const titulo = await screen.findByRole("heading", { name: /LOPDP-00012/ });
    await waitFor(() => expect(titulo).toHaveFocus());
    expect(titulo).toHaveAttribute("id", "pv-mia-12");
    expect(servicio.miSolicitud).toHaveBeenCalledWith(12);
    expect(
      await screen.findByText("Lo estamos revisando."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ocultar historial de LOPDP-00012" }),
    ).toHaveAttribute("aria-expanded", "true");
    // Las demás quedan cerradas.
    expect(
      screen.getByRole("button", { name: "Ver historial de LOPDP-00005" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("error al cargar: se puede reintentar", async () => {
    servicio.misSolicitudes.mockRejectedValueOnce(
      errorApi(500, "error", "Falló el servidor."),
    );
    pintarPerfil();
    expect(await screen.findByText("Falló el servidor.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("list", { name: "Sus solicitudes" }),
    ).toBeInTheDocument();
  });
});

describe("Mis derechos: descargar mis datos", () => {
  it("descarga en Excel y en JSON y anuncia el archivo", async () => {
    pintarPerfil();
    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar en Excel/ }),
    );
    expect(servicio.descargarMisDatos).toHaveBeenCalledWith("xlsx");
    expect(
      await screen.findByText("Descarga lista: mis-datos-aperez.xlsx."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Descargar en JSON/ }));
    await waitFor(() =>
      expect(servicio.descargarMisDatos).toHaveBeenLastCalledWith("json"),
    );
  });

  it("no descarga dos veces con un doble clic", async () => {
    let soltar;
    servicio.descargarMisDatos.mockReturnValue(
      new Promise((r) => {
        soltar = r;
      }),
    );
    pintarPerfil();
    const excel = await screen.findByRole("button", {
      name: /Descargar en Excel/,
    });
    fireEvent.click(excel);
    fireEvent.click(excel);
    expect(servicio.descargarMisDatos).toHaveBeenCalledTimes(1);
    expect(excel).toHaveAttribute("aria-disabled", "true");
    await act(async () => soltar("x.xlsx"));
  });

  it("el 429 del límite se explica y «Reintentar» repite el mismo formato", async () => {
    servicio.descargarMisDatos.mockRejectedValueOnce(
      errorApi(
        429,
        "throttled",
        "Demasiadas solicitudes seguidas. Intente de nuevo en 5 minutos.",
      ),
    );
    pintarPerfil();
    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar en JSON/ }),
    );
    expect(
      await screen.findByText(/Intente de nuevo en 5 minutos/),
    ).toBeInTheDocument();
    const reintentar = screen.getByRole("button", { name: /Reintentar/ });
    await waitFor(() => expect(reintentar).toHaveFocus());
    fireEvent.click(reintentar);
    await waitFor(() =>
      expect(servicio.descargarMisDatos).toHaveBeenLastCalledWith("json"),
    );
  });

  it("dice qué incluye y qué no", async () => {
    pintarPerfil();
    expect(await screen.findByText("Cuenta")).toBeInTheDocument();
    expect(screen.getByText(/Mensajes que envió/)).toBeInTheDocument();
    expect(
      screen.getByText(/solo usted puede descargarlo/),
    ).toBeInTheDocument();
    expect(screen.getByText("Rol de pagos")).toBeInTheDocument();
    expect(screen.getByText(/Tiene su propia descarga/)).toBeInTheDocument();
  });
});

describe("Mis derechos: nueva solicitud", () => {
  async function abrir() {
    pintarPerfil();
    fireEvent.click(
      await screen.findByRole("button", { name: /Hacer una solicitud/ }),
    );
    return screen.findByRole("dialog", {
      name: "Nueva solicitud sobre sus datos",
    });
  }

  it("pide elegir el tipo antes de enviar", async () => {
    const ventana = await abrir();
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Enviar solicitud/ }),
    );
    const error = await within(ventana).findByText("Elija qué quiere pedir.");
    expect(servicio.crearSolicitud).not.toHaveBeenCalled();
    const acceso = within(ventana).getByRole("radio", {
      name: /Acceso a mis datos/,
    });
    expect(acceso).toHaveFocus();
    // Cada opción lleva el error en su descripción: se oye al recorrerlas.
    for (const radio of within(ventana).getAllByRole("radio"))
      expect(radio.getAttribute("aria-describedby").split(" ")).toContain(
        error.id,
      );
    expect(acceso).toHaveAccessibleDescription(/Elija qué quiere pedir/);
  });

  it("mientras envía el botón no se deshabilita; un fallo general recibe el foco", async () => {
    let fallar;
    servicio.crearSolicitud.mockReturnValue(
      new Promise((_, rechazar) => {
        fallar = rechazar;
      }),
    );
    const ventana = await abrir();
    fireEvent.click(
      within(ventana).getByRole("radio", { name: /Acceso a mis datos/ }),
    );
    const enviar = within(ventana).getByRole("button", {
      name: /Enviar solicitud/,
    });
    fireEvent.click(enviar);
    const enviando = await within(ventana).findByRole("button", {
      name: /Enviando/,
    });
    expect(enviando).not.toBeDisabled();
    expect(enviando).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(enviando);
    expect(servicio.crearSolicitud).toHaveBeenCalledTimes(1);
    await act(async () =>
      fallar(errorApi(500, "error", "El servidor no respondió.")),
    );
    const alerta = within(ventana).getByRole("alert");
    expect(alerta).toHaveTextContent("El servidor no respondió.");
    await waitFor(() => expect(alerta).toHaveFocus());
  });

  it("en la corrección la descripción es obligatoria, con contador", async () => {
    const ventana = await abrir();
    fireEvent.click(
      within(ventana).getByRole("radio", { name: /Corrección de mis datos/ }),
    );
    const descripcion = within(ventana).getByRole("textbox", {
      name: /Descripción/,
    });
    expect(descripcion).toHaveAttribute("aria-required", "true");
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Enviar solicitud/ }),
    );
    expect(
      await within(ventana).findByText(
        "Describa qué dato quiere corregir y por qué.",
      ),
    ).toBeInTheDocument();
    expect(descripcion).toHaveFocus();
    expect(servicio.crearSolicitud).not.toHaveBeenCalled();
    fireEvent.change(descripcion, { target: { value: "Mi cédula" } });
    expect(
      within(ventana).getByText(/9 de 2000 caracteres/),
    ).toBeInTheDocument();
  });

  it("en el acceso la descripción es opcional", async () => {
    servicio.crearSolicitud.mockResolvedValue({
      solicitud: solicitud({ id: 13, numero: "LOPDP-00013", tipo: "ACCESO" }),
      creada: true,
    });
    const ventana = await abrir();
    fireEvent.click(
      within(ventana).getByRole("radio", { name: /Acceso a mis datos/ }),
    );
    expect(
      within(ventana).getByRole("textbox", {
        name: /Descripción \(opcional\)/,
      }),
    ).not.toHaveAttribute("aria-required");
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Enviar solicitud/ }),
    );
    await waitFor(() =>
      expect(servicio.crearSolicitud).toHaveBeenCalledWith({
        tipo: "ACCESO",
        descripcion: "",
      }),
    );
  });

  it("la eliminación aclara que se gestiona a mano y que algo se conserva", async () => {
    const ventana = await abrir();
    fireEvent.click(
      within(ventana).getByRole("radio", { name: /Eliminación de mis datos/ }),
    );
    expect(
      within(ventana).getByText(/hace la eliminación a mano/),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText(/la ley obliga a guardarlos/),
    ).toBeInTheDocument();
  });

  it("al enviar: cierra, avisa con el número, la suma arriba y le lleva el foco", async () => {
    const nueva = solicitud({
      id: 13,
      numero: "LOPDP-00013",
      estado: "PENDIENTE",
      estado_label: "Pendiente",
    });
    servicio.crearSolicitud.mockResolvedValue({
      solicitud: nueva,
      creada: true,
    });
    const ventana = await abrir();
    fireEvent.click(
      within(ventana).getByRole("radio", { name: /Corrección de mis datos/ }),
    );
    fireEvent.change(
      within(ventana).getByRole("textbox", { name: /Descripción/ }),
      { target: { value: "  Mi segundo apellido es Ruiz.  " } },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Enviar solicitud/ }),
    );
    await waitFor(() =>
      expect(servicio.crearSolicitud).toHaveBeenCalledWith({
        tipo: "RECTIFICACION",
        descripcion: "Mi segundo apellido es Ruiz.",
      }),
    );
    expect(
      await screen.findByText(/Recibimos su solicitud LOPDP-00013/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const items = within(
      screen.getByRole("list", { name: "Sus solicitudes" }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: /LOPDP-00013/ }),
      ).toHaveFocus(),
    );
  });

  it("si ya había una igual abierta, lo dice y no la duplica", async () => {
    servicio.crearSolicitud.mockResolvedValue({
      solicitud: solicitud(),
      creada: false,
    });
    const ventana = await abrir();
    fireEvent.click(
      within(ventana).getByRole("radio", { name: /Corrección de mis datos/ }),
    );
    fireEvent.change(
      within(ventana).getByRole("textbox", { name: /Descripción/ }),
      { target: { value: "Mi segundo apellido está mal escrito." } },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Enviar solicitud/ }),
    );
    expect(
      await screen.findByText(/Ya tenía una solicitud igual abierta/),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("list", { name: "Sus solicitudes" }),
      ).getAllByRole("listitem"),
    ).toHaveLength(3);
  });

  it("el error del servidor va bajo su campo", async () => {
    servicio.crearSolicitud.mockRejectedValue(
      errorApi(400, "validation_error", "La descripción es muy larga.", {
        descripcion: ["La descripción es muy larga."],
      }),
    );
    const ventana = await abrir();
    fireEvent.click(
      within(ventana).getByRole("radio", { name: /Eliminación de mis datos/ }),
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Enviar solicitud/ }),
    );
    const campo = within(ventana).getByRole("textbox", { name: /Descripción/ });
    await waitFor(() => expect(campo).toHaveAttribute("aria-invalid", "true"));
    expect(
      within(ventana).getByText("La descripción es muy larga."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

// --- La bandeja ---------------------------------------------------------------

function pintarBandeja(ruta = "/admin/privacidad/solicitudes") {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route
          path="/admin/privacidad/solicitudes"
          element={
            <RequirePermission permission={PERMISOS_PRIVACIDAD}>
              <BandejaPrivacidad />
            </RequirePermission>
          }
        />
        <Route
          path="/admin/privacidad/solicitudes/:id"
          element={
            <RequirePermission permission={PERMISOS_PRIVACIDAD}>
              <DetalleSolicitudPrivacidad />
            </RequirePermission>
          }
        />
        <Route path="/403" element={<p>Acceso denegado</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Bandeja: permisos", () => {
  it("sin privacidad.ver ni .atender lleva al 403", () => {
    usuario.current = { id: 1, permissions: ["auditoria.ver"] };
    pintarBandeja();
    expect(screen.getByText("Acceso denegado")).toBeInTheDocument();
    expect(servicio.bandeja).not.toHaveBeenCalled();
  });

  it("con privacidad.ver se abre", async () => {
    usuario.current = { id: 1, permissions: ["privacidad.ver"] };
    pintarBandeja();
    expect(
      await screen.findByRole("link", { name: /LOPDP-00003/ }),
    ).toBeInTheDocument();
  });

  it("con privacidad.atender también", async () => {
    usuario.current = { id: 1, permissions: ["privacidad.atender"] };
    pintarBandeja();
    expect(
      await screen.findByRole("link", { name: /LOPDP-00012/ }),
    ).toBeInTheDocument();
  });
});

describe("Bandeja: listado y filtros", () => {
  beforeEach(() => {
    usuario.current = { id: 1, permissions: ["privacidad.atender"] };
  });

  it("muestra cada solicitud con titular, estado y vencida en texto, y los totales", async () => {
    pintarBandeja();
    const enlace = await screen.findByRole("link", {
      name: "LOPDP-00003 de Ana Pérez",
    });
    expect(enlace).toHaveAttribute("href", "/admin/privacidad/solicitudes/3");
    const fila = enlace.closest("tr");
    expect(within(fila).getByText("Pendiente")).toBeInTheDocument();
    expect(within(fila).getByText("Vencida")).toBeInTheDocument();
    expect(
      within(fila).getByText("Eliminación de mis datos"),
    ).toBeInTheDocument();
    expect(within(fila).getByText("aperez@grupolaar.com")).toBeInTheDocument();
    const totales = screen.getByText("abiertas").closest("p");
    expect(totales).toHaveTextContent("En total: 2 abiertas");
    expect(totales).toHaveTextContent("1 vencida");
    // Sin región viva: el resultado de cada filtro lo anuncia otra.
    expect(totales).not.toHaveAttribute("role");
    expect(
      screen.getByRole("searchbox", { name: "Buscar solicitudes" }),
    ).toHaveAttribute(
      "placeholder",
      "Número, nombre, usuario o correo del titular",
    );
  });

  it("filtra por estado, tipo y vencidas", async () => {
    pintarBandeja();
    await screen.findByRole("link", { name: /LOPDP-00003/ });
    fireEvent.change(screen.getByLabelText("Estado"), {
      target: { value: "PENDIENTE" },
    });
    await waitFor(() =>
      expect(servicio.bandeja).toHaveBeenLastCalledWith(
        expect.objectContaining({ estado: "PENDIENTE", page: 1 }),
      ),
    );
    fireEvent.change(screen.getByLabelText("Tipo"), {
      target: { value: "ACCESO" },
    });
    await waitFor(() =>
      expect(servicio.bandeja).toHaveBeenLastCalledWith(
        expect.objectContaining({ estado: "PENDIENTE", tipo: "ACCESO" }),
      ),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Solo vencidas" }));
    await waitFor(() =>
      expect(servicio.bandeja).toHaveBeenLastCalledWith(
        expect.objectContaining({ vencidas: "1" }),
      ),
    );
  });

  it("toma los filtros de la URL", async () => {
    pintarBandeja("/admin/privacidad/solicitudes?estado=RESUELTA&vencidas=1");
    await waitFor(() =>
      expect(servicio.bandeja).toHaveBeenCalledWith(
        expect.objectContaining({ estado: "RESUELTA", vencidas: "1" }),
      ),
    );
    expect(screen.getByLabelText("Estado")).toHaveValue("RESUELTA");
    expect(
      screen.getByRole("checkbox", { name: "Solo vencidas" }),
    ).toBeChecked();
  });

  it("busca en vivo por el titular", async () => {
    pintarBandeja();
    await screen.findByRole("link", { name: /LOPDP-00003/ });
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Buscar solicitudes" }),
      { target: { value: "ana" } },
    );
    await waitFor(() =>
      expect(servicio.bandeja).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "ana" }),
      ),
    );
  });

  it("sin resultados con filtros: «Limpiar filtros» los quita y vuelve al buscador", async () => {
    servicio.bandeja.mockResolvedValue(paginaDe([]));
    pintarBandeja("/admin/privacidad/solicitudes?q=zzz");
    expect(
      await screen.findByText("Sin resultados para «zzz»."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    await waitFor(() =>
      expect(servicio.bandeja).toHaveBeenLastCalledWith({ page: 1 }),
    );
    expect(
      screen.getByRole("searchbox", { name: "Buscar solicitudes" }),
    ).toHaveFocus();
  });
});

// --- El detalle ---------------------------------------------------------------

const HISTORIAL_BANDEJA = HISTORIAL.map((h, i) => ({
  ...h,
  actor: i ? { id: 2, nombre: "Carla Ruiz" } : null,
}));

function detalle(extra = {}) {
  return deBandeja(
    solicitud({ estado: "PENDIENTE", estado_label: "Pendiente" }),
    {
      historial: HISTORIAL_BANDEJA,
      puede_descargar_datos: false,
      ...extra,
    },
  );
}

describe("Detalle de una solicitud", () => {
  beforeEach(() => {
    usuario.current = { id: 1, permissions: ["privacidad.atender"] };
    servicio.yo.mockResolvedValue(ME_ATIENDE);
    servicio.solicitud.mockResolvedValue(detalle());
  });

  it("muestra el titular, lo pedido y el historial con quién movió cada estado", async () => {
    pintarBandeja("/admin/privacidad/solicitudes/12");
    expect(
      await screen.findByRole("heading", { name: /Solicitud LOPDP-00012/ }),
    ).toBeInTheDocument();
    expect(servicio.solicitud).toHaveBeenCalledWith("12");
    expect(
      screen.getByText("Mi segundo apellido está mal escrito."),
    ).toBeInTheDocument();
    expect(screen.getByText(/aperez@grupolaar.com/)).toBeInTheDocument();
    const historial = screen.getByRole("region", { name: "Historial" });
    expect(within(historial).getByText(/Carla Ruiz/)).toBeInTheDocument();
    expect(
      within(historial).getByText("Lo estamos revisando."),
    ).toBeInTheDocument();
  });

  it("descarga los datos del titular solo si procede", async () => {
    servicio.solicitud.mockResolvedValue(
      detalle({ tipo: "ACCESO", puede_descargar_datos: true }),
    );
    pintarBandeja("/admin/privacidad/solicitudes/12");
    const excel = await screen.findByRole("button", {
      name: "Descargar en Excel del titular",
    });
    fireEvent.click(excel);
    expect(servicio.descargarDatosDelTitular).toHaveBeenCalledWith(12, "xlsx");
  });

  it("sin puede_descargar_datos no ofrece la descarga", async () => {
    pintarBandeja("/admin/privacidad/solicitudes/12");
    await screen.findByRole("heading", { name: /Solicitud LOPDP-00012/ });
    await screen.findByRole("region", {
      name: "Responder y cambiar el estado",
    });
    expect(
      screen.queryByRole("button", { name: /del titular/ }),
    ).not.toBeInTheDocument();
  });

  it("con solo privacidad.ver no hay cambio de estado", async () => {
    usuario.current = { id: 1, permissions: ["privacidad.ver"] };
    servicio.yo.mockResolvedValue(ME_SOLO_VE);
    pintarBandeja("/admin/privacidad/solicitudes/12");
    await screen.findByRole("heading", { name: /Solicitud LOPDP-00012/ });
    await waitFor(() => expect(servicio.yo).toHaveBeenCalled());
    expect(
      screen.queryByRole("region", { name: "Responder y cambiar el estado" }),
    ).not.toBeInTheDocument();
  });

  it("si no se sabe si puede atender, lo dice y se puede reintentar", async () => {
    servicio.yo.mockRejectedValueOnce(
      errorApi(500, "error", "Falló el servidor."),
    );
    pintarBandeja("/admin/privacidad/solicitudes/12");
    expect(await screen.findByText("Falló el servidor.")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Responder y cambiar el estado" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("region", {
        name: "Responder y cambiar el estado",
      }),
    ).toBeInTheDocument();
    expect(servicio.yo).toHaveBeenCalledTimes(2);
  });

  it("no encontrada: lo dice sin pantalla en blanco", async () => {
    servicio.solicitud.mockRejectedValue(
      errorApi(404, "not_found", "Solicitud no encontrada."),
    );
    pintarBandeja("/admin/privacidad/solicitudes/99");
    expect(
      await screen.findByText(/No se encontró la solicitud/),
    ).toBeInTheDocument();
  });
});

describe("Detalle: cambio de estado", () => {
  beforeEach(() => {
    usuario.current = { id: 1, permissions: ["privacidad.atender"] };
    servicio.yo.mockResolvedValue(ME_ATIENDE);
    servicio.solicitud.mockResolvedValue(detalle());
  });

  async function formulario() {
    pintarBandeja("/admin/privacidad/solicitudes/12");
    return screen.findByRole("region", {
      name: "Responder y cambiar el estado",
    });
  }

  it("ofrece solo los pasos válidos desde el estado actual", async () => {
    const f = await formulario();
    const pasos = within(f)
      .getAllByRole("radio")
      .map((r) => r.closest("label").textContent);
    expect(pasos).toEqual([
      "Pasar a «En proceso»",
      "Marcar como resuelta",
      "Rechazar",
    ]);
  });

  it("al cerrar exige la respuesta y manda el estado esperado", async () => {
    const resuelta = detalle({
      estado: "RESUELTA",
      estado_label: "Resuelta",
      respuesta: "Corregimos su apellido.",
    });
    servicio.cambiarEstado.mockResolvedValue(resuelta);
    const f = await formulario();
    fireEvent.click(
      within(f).getByRole("button", { name: /Guardar y avisar/ }),
    );
    expect(
      await within(f).findByText("Elija a qué estado pasa."),
    ).toBeInTheDocument();
    fireEvent.click(
      within(f).getByRole("radio", { name: "Marcar como resuelta" }),
    );
    fireEvent.click(
      within(f).getByRole("button", { name: /Guardar y avisar/ }),
    );
    expect(
      await within(f).findByText("Escriba la respuesta para el titular."),
    ).toBeInTheDocument();
    const respuesta = within(f).getByRole("textbox", {
      name: /Respuesta al titular/,
    });
    expect(respuesta).toHaveFocus();
    expect(servicio.cambiarEstado).not.toHaveBeenCalled();
    fireEvent.change(respuesta, {
      target: { value: "Corregimos su apellido." },
    });
    fireEvent.click(
      within(f).getByRole("button", { name: /Guardar y avisar/ }),
    );
    await waitFor(() =>
      expect(servicio.cambiarEstado).toHaveBeenCalledWith(12, {
        estado: "RESUELTA",
        respuesta: "Corregimos su apellido.",
        estadoEsperado: "PENDIENTE",
      }),
    );
    expect(
      await screen.findByText(/La solicitud pasó a «Resuelta»/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Resumen" })).toHaveFocus(),
    );
  });

  it("el error del paso va en cada opción y marca el grupo", async () => {
    const f = await formulario();
    fireEvent.click(
      within(f).getByRole("button", { name: /Guardar y avisar/ }),
    );
    const error = await within(f).findByText("Elija a qué estado pasa.");
    expect(within(f).getByRole("group", { name: /Pasar a/ })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    for (const radio of within(f).getAllByRole("radio"))
      expect(radio).toHaveAttribute("aria-describedby", error.id);
    expect(within(f).getAllByRole("radio")[0]).toHaveFocus();
  });

  it("tras el cambio avisa al menú para que la insignia se ponga al día", async () => {
    const escucha = vi.fn();
    window.addEventListener(EVENTO_INSIGNIAS, escucha);
    servicio.cambiarEstado.mockResolvedValue(
      detalle({ estado: "EN_PROCESO", estado_label: "En proceso" }),
    );
    const f = await formulario();
    fireEvent.click(
      within(f).getByRole("radio", { name: "Pasar a «En proceso»" }),
    );
    fireEvent.click(
      within(f).getByRole("button", { name: /Guardar y avisar/ }),
    );
    await screen.findByText(/La solicitud pasó a «En proceso»/);
    expect(escucha).toHaveBeenCalledTimes(1);
    window.removeEventListener(EVENTO_INSIGNIAS, escucha);
  });

  it("un fallo sin campo se muestra arriba y recibe el foco; el botón no se deshabilita", async () => {
    let fallar;
    servicio.cambiarEstado.mockReturnValue(
      new Promise((_, rechazar) => {
        fallar = rechazar;
      }),
    );
    const f = await formulario();
    fireEvent.click(
      within(f).getByRole("radio", { name: "Pasar a «En proceso»" }),
    );
    fireEvent.click(
      within(f).getByRole("button", { name: /Guardar y avisar/ }),
    );
    const guardando = await within(f).findByRole("button", {
      name: /Guardando/,
    });
    expect(guardando).not.toBeDisabled();
    expect(guardando).toHaveAttribute("aria-disabled", "true");
    await act(async () =>
      fallar(errorApi(500, "error", "El servidor no respondió.")),
    );
    const alerta = within(f).getByRole("alert");
    expect(alerta).toHaveTextContent("El servidor no respondió.");
    await waitFor(() => expect(alerta).toHaveFocus());
  });

  it("pasar a «En proceso» desde pendiente no exige respuesta", async () => {
    servicio.cambiarEstado.mockResolvedValue(
      detalle({ estado: "EN_PROCESO", estado_label: "En proceso" }),
    );
    const f = await formulario();
    fireEvent.click(
      within(f).getByRole("radio", { name: "Pasar a «En proceso»" }),
    );
    fireEvent.click(
      within(f).getByRole("button", { name: /Guardar y avisar/ }),
    );
    await waitFor(() =>
      expect(servicio.cambiarEstado).toHaveBeenCalledWith(12, {
        estado: "EN_PROCESO",
        respuesta: "",
        estadoEsperado: "PENDIENTE",
      }),
    );
  });

  it("reabrir una cerrada exige el motivo", async () => {
    servicio.solicitud.mockResolvedValue(
      detalle({
        estado: "RECHAZADA",
        estado_label: "Rechazada",
        dias_restantes: null,
      }),
    );
    const f = await formulario();
    fireEvent.click(within(f).getByRole("radio", { name: /Reabrir/ }));
    fireEvent.click(
      within(f).getByRole("button", { name: /Guardar y avisar/ }),
    );
    expect(
      await within(f).findByText("Escriba por qué se reabre la solicitud."),
    ).toBeInTheDocument();
    expect(
      within(f).getByRole("textbox", { name: /Motivo de la reapertura/ }),
    ).toHaveFocus();
  });

  it("409: avisa, recarga con el estado actual y conserva la respuesta escrita", async () => {
    servicio.cambiarEstado.mockRejectedValue(
      errorApi(
        409,
        "conflicto",
        "Otra persona ya cambió esta solicitud. Recargue para ver su estado actual.",
        { estado_actual: "EN_PROCESO" },
      ),
    );
    const f = await formulario();
    fireEvent.click(within(f).getByRole("radio", { name: "Rechazar" }));
    fireEvent.change(
      within(f).getByRole("textbox", { name: /Respuesta al titular/ }),
      { target: { value: "No procede." } },
    );
    servicio.solicitud.mockResolvedValue(
      detalle({ estado: "EN_PROCESO", estado_label: "En proceso" }),
    );
    fireEvent.click(
      within(f).getByRole("button", { name: /Guardar y avisar/ }),
    );
    expect(
      await screen.findByText(/Otra persona ya cambió esta solicitud/),
    ).toBeInTheDocument();
    await waitFor(() => expect(servicio.solicitud).toHaveBeenCalledTimes(2));
    // Recargada: desde «En proceso» ya no se ofrece pasar a «En proceso».
    await waitFor(() =>
      expect(
        screen.queryByRole("radio", { name: "Pasar a «En proceso»" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("textbox", { name: /Respuesta al titular/ }),
    ).toHaveValue("No procede.");
    await waitFor(() =>
      expect(
        screen
          .getByText(/Otra persona ya cambió esta solicitud/)
          .closest(".mz-alert"),
      ).toHaveFocus(),
    );
  });
});

// --- Menú ---------------------------------------------------------------------

describe("Protección de datos en el menú", () => {
  const ids = (permisos) =>
    getVisibleAdminMenu(permisos).map((item) => item.id);

  it("aparece con privacidad.ver o privacidad.atender, en la zona común", () => {
    expect(ids(["privacidad.ver"])).toContain("privacidad");
    expect(ids(["privacidad.atender"])).toContain("privacidad");
    expect(
      getVisibleAdminMenu(["privacidad.ver"], "institucional").map((i) => i.id),
    ).toContain("privacidad");
  });

  it("no aparece sin esos permisos", () => {
    expect(ids(["auditoria.ver", "activos.ver"])).not.toContain("privacidad");
  });

  it("lleva la insignia de vencidas, dicha en texto", () => {
    const item = getVisibleAdminMenu(["privacidad.ver"]).find(
      (i) => i.id === "privacidad",
    );
    expect(item.path).toBe("/admin/privacidad/solicitudes");
    expect(item.insignia).toBe("privacidad_vencidas");
    expect(TEXTOS.privacidad_vencidas[0]).toMatch(/vencidas/);
    expect(sufijoDeInsignia("privacidad_vencidas", 1)).toBe(
      "solicitud vencida",
    );
    expect(sufijoDeInsignia("privacidad_vencidas", 3)).toBe(
      "solicitudes vencidas",
    );
  });

  it("su ruta es común: no cambia el módulo elegido", () => {
    expect(moduloDeRuta("/admin/privacidad/solicitudes/3")).toBeNull();
  });
});
