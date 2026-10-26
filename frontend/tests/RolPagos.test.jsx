import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Consultar rol de pagos: el código sale de la sesión; ver pide aceptar los
 * términos y la contraseña; luego se puede enviar al correo personal, que solo
 * se guarda si se pide y se acepta.
 */

const servicio = {
  estado: vi.fn(),
  consultar: vi.fn(),
  enviar: vi.fn(),
  olvidarCorreo: vi.fn(),
  configurar: vi.fn(),
  conformidad: vi.fn(),
  historial: vi.fn(),
  rolDelHistorial: vi.fn(),
  misObservaciones: vi.fn(),
  habilitados: vi.fn(),
  habilitar: vi.fn(),
  areasDescargaMasiva: vi.fn(),
  descargaMasiva: vi.fn(),
  seguimiento: vi.fn(),
  resumenSeguimiento: vi.fn(),
  exportarSeguimiento: vi.fn(),
  recordarPendientes: vi.fn(),
  personaAuditada: vi.fn(),
  rolAuditado: vi.fn(),
};
vi.mock("../src/api/nominaService", () => ({ nominaService: servicio }));
vi.mock("../src/components/common/VisorPdf/VisorPdf", () => ({
  MarcoPdf: () => <div />,
  useUrlDePdf: () => "blob:rol",
  VisorPdf: ({ titulo }) => <div role="dialog" aria-label={titulo} />,
}));

vi.mock("../src/utils/descargas", () => ({ descargarBlob: vi.fn() }));
const { descargarBlob } = await import("../src/utils/descargas");

const { RolPagosPage } =
  await import("../src/pages/Institucional/RolPagosPage");

const ESTADO = {
  codigo: "20104758",
  terminos: "Declaro que soy el titular de este rol.",
  version: 3,
  consentimiento_correo: "Autorizo guardar mi correo.",
  correo_guardado: "",
  disponible: true,
  puede_consultar_otros: false,
  puede_configurar: false,
  // En la lista de habilitados (22/10/2026).
  habilitado: true,
  puede_habilitar: false,
};

/** Un mes sin nadie en ninguna lista (cada prueba pone lo suyo). */
const SEGUIMIENTO = {
  anio: 2025,
  mes: 9,
  periodo: "Septiembre 2025",
  habilitados: 0,
  totales: { sin_abrir: 0, sin_aceptar: 0, con_observacion: 0, aceptados: 0 },
  sin_abrir: [],
  sin_aceptar: [],
  con_observacion: [],
  aceptados: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  servicio.estado.mockResolvedValue(ESTADO);
  servicio.misObservaciones.mockResolvedValue([]);
});

async function consultar() {
  render(<RolPagosPage />);
  expect(await screen.findByLabelText("Código de empleado")).toHaveValue(
    "20104758",
  );
  fireEvent.change(screen.getByLabelText("Año"), { target: { value: "2026" } });
  fireEvent.change(screen.getByLabelText("Mes"), { target: { value: "9" } });
  fireEvent.click(screen.getByRole("button", { name: /Consultar/ }));
  const ventana = screen.getByRole("dialog", {
    name: "Confirmar consulta del rol de pagos",
  });
  return ventana;
}

describe("Consultar rol de pagos", () => {
  it("el código sale de la sesión y ver pide aceptar y la contraseña", async () => {
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 41,
    });
    const ventana = await consultar();
    expect(screen.getByLabelText("Código de empleado")).toHaveAttribute(
      "readonly",
    );
    expect(
      within(ventana).getByText("Declaro que soy el titular de este rol."),
    ).toBeInTheDocument();
    const ver = within(ventana).getByRole("button", {
      name: "Ver rol de pagos",
    });
    expect(ver).toBeDisabled();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.change(
      within(ventana).getByLabelText("Contraseña de su cuenta"),
      {
        target: { value: "secreta" },
      },
    );
    fireEvent.click(ver);
    await waitFor(() =>
      expect(servicio.consultar).toHaveBeenCalledWith({
        anio: 2026,
        mes: 9,
        codigo: "20104758", // autocompletado con el de la sesión
        acepto: true,
        version: 3,
        password: "secreta",
      }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Rol de pagos · Septiembre 2026",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Enviar a mi correo personal/ }),
    ).toBeInTheDocument();
  });

  it("con la contraseña equivocada lo dice y no muestra el rol", async () => {
    servicio.consultar.mockRejectedValue({
      response: {
        status: 403,
        data: new Blob([
          JSON.stringify({ detail: "La contraseña no es correcta." }),
        ]),
      },
    });
    const ventana = await consultar();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.change(
      within(ventana).getByLabelText("Contraseña de su cuenta"),
      {
        target: { value: "mala" },
      },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Ver rol de pagos" }),
    );
    expect(
      await within(ventana).findByText("La contraseña no es correcta."),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByLabelText("Contraseña de su cuenta"),
    ).toHaveValue("");
  });

  it("enviar al correo: no se guarda salvo que se pida y se acepte", async () => {
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 41,
    });
    servicio.enviar.mockResolvedValue({ enviado_a: "r***@gmail.com" });
    const ventana = await consultar();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.change(
      within(ventana).getByLabelText("Contraseña de su cuenta"),
      {
        target: { value: "secreta" },
      },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Ver rol de pagos" }),
    );
    const correo = await screen.findByLabelText("Correo personal");
    fireEvent.change(correo, { target: { value: "rosa@gmail.com" } });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Guardar este correo/ }),
    );
    const enviar = screen.getByRole("button", { name: "Enviar" });
    // Pidió guardarlo: sin aceptar el tratamiento de datos no se envía.
    expect(screen.getByText("Autorizo guardar mi correo.")).toBeInTheDocument();
    expect(enviar).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Acepto que se almacene/ }),
    );
    fireEvent.click(enviar);
    await waitFor(() =>
      expect(servicio.enviar).toHaveBeenCalledWith({
        consulta: 41,
        correo: "rosa@gmail.com",
        guardar: true,
        acepto_guardar: true,
      }),
    );
    expect(
      await screen.findByText("Listo: se envió a r***@gmail.com."),
    ).toBeInTheDocument();
  });

  it("sin código de empleado lo dice y no deja consultar", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, codigo: "" });
    render(<RolPagosPage />);
    expect(
      await screen.findByText(/todavía no tiene código de empleado/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Consultar/ })).toBeDisabled();
  });

  it("Talento Humano lo ve autocompletado, puede cambiarlo y volver al suyo", async () => {
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      puede_consultar_otros: true,
    });
    render(<RolPagosPage />);
    const codigo = await screen.findByLabelText("Código de empleado");
    expect(codigo).not.toHaveAttribute("readonly");
    await waitFor(() => expect(codigo).toHaveValue("20104758"));
    fireEvent.change(codigo, { target: { value: "20100001" } });
    expect(screen.getByText(/Consultando a otra persona/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Volver a mi código" }));
    expect(codigo).toHaveValue("20104758");
  });

  it("sin permiso el código es el de su cuenta y no se puede cambiar", async () => {
    render(<RolPagosPage />);
    const codigo = await screen.findByLabelText("Código de empleado");
    expect(codigo).toHaveValue("20104758");
    expect(codigo).toHaveAttribute("readonly");
    expect(
      screen.getByText(/Solo su código; prohibido usar el de otra persona/),
    ).toBeInTheDocument();
  });

  it("un mes sin rol cierra la ventana y lo explica en la página", async () => {
    servicio.consultar.mockRejectedValue({
      response: {
        status: 404,
        data: new Blob([
          JSON.stringify({
            detail:
              "No hay rol de pagos de abril de 2026 para el código 20104758.",
          }),
        ]),
      },
    });
    const ventana = await consultar();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.change(
      within(ventana).getByLabelText("Contraseña de su cuenta"),
      {
        target: { value: "secreta" },
      },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Ver rol de pagos" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Sin rol de pagos para septiembre de 2026",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No hay rol de pagos de abril de 2026/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", {
        name: "Confirmar consulta del rol de pagos",
      }),
    ).toBeNull();
    // Sin rol no se ofrece enviarlo al correo.
    expect(
      screen.queryByRole("heading", { name: /Enviar a mi correo/ }),
    ).toBeNull();
  });

  it("en el visor se confirma que está de acuerdo", async () => {
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 41,
    });
    servicio.conformidad.mockResolvedValue({
      conformidad: "conforme",
      conformidad_display: "Estuvo de acuerdo",
      dia: "martes",
      fecha: "21/10/2026",
      hora: "10:32:05",
      ip: "192.168.1.20",
    });
    const ventana = await consultar();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.change(
      within(ventana).getByLabelText("Contraseña de su cuenta"),
      {
        target: { value: "secreta" },
      },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Ver rol de pagos" }),
    );
    const visor = await screen.findByRole("dialog", {
      name: "Rol de pagos · Septiembre 2026",
    });
    fireEvent.click(
      within(visor).getByRole("button", { name: /Estoy de acuerdo/ }),
    );
    await waitFor(() =>
      expect(servicio.conformidad).toHaveBeenCalledWith(41, "conforme", ""),
    );
    expect(
      await within(visor).findByText("Estuvo de acuerdo"),
    ).toBeInTheDocument();
    expect(
      within(visor).getByText(
        /el martes 21\/10\/2026 a las 10:32:05 desde la IP 192.168.1.20/,
      ),
    ).toBeInTheDocument();
    // Ya respondió: cierra sin advertencia.
    fireEvent.click(
      within(visor).getByRole("button", { name: "Cerrar visor" }),
    );
    expect(screen.queryByRole("dialog", { name: /Rol de pagos ·/ })).toBeNull();
  });

  it("cerrar sin responder advierte que es aceptar el rol", async () => {
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 42,
    });
    servicio.conformidad.mockResolvedValue({
      conformidad: "conforme_al_cerrar",
      conformidad_display: "Aceptó al cerrar sin responder",
    });
    const ventana = await consultar();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.change(
      within(ventana).getByLabelText("Contraseña de su cuenta"),
      {
        target: { value: "secreta" },
      },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Ver rol de pagos" }),
    );
    const visor = await screen.findByRole("dialog", {
      name: "Rol de pagos · Septiembre 2026",
    });
    fireEvent.click(
      within(visor).getByRole("button", { name: "Cerrar visor" }),
    );
    const aviso = screen.getByRole("alertdialog", {
      name: /Cerrar sin responder/,
    });
    expect(aviso).toHaveTextContent(/acepta que su rol de pagos es correcto/);
    // Volver no cierra ni registra nada.
    fireEvent.click(
      within(aviso).getByRole("button", { name: "Volver al rol" }),
    );
    expect(servicio.conformidad).not.toHaveBeenCalled();
    fireEvent.click(
      within(visor).getByRole("button", { name: "Cerrar visor" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cerrar y aceptar" }));
    await waitFor(() =>
      expect(servicio.conformidad).toHaveBeenCalledWith(
        42,
        "conforme_al_cerrar",
        "",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /Rol de pagos ·/ }),
      ).toBeNull(),
    );
  });

  it("una observación pide texto y se envía", async () => {
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 43,
    });
    servicio.conformidad.mockResolvedValue({
      conformidad: "observacion",
      conformidad_display: "Dejó una observación",
    });
    const ventana = await consultar();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.change(
      within(ventana).getByLabelText("Contraseña de su cuenta"),
      {
        target: { value: "secreta" },
      },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Ver rol de pagos" }),
    );
    const visor = await screen.findByRole("dialog", {
      name: "Rol de pagos · Septiembre 2026",
    });
    fireEvent.click(
      within(visor).getByRole("button", { name: /Tengo una observación/ }),
    );
    const enviar = within(visor).getByRole("button", {
      name: "Enviar observación",
    });
    expect(enviar).toBeDisabled();
    fireEvent.change(within(visor).getByLabelText(/Qué no está correcto/), {
      target: { value: "Faltan horas extra." },
    });
    fireEvent.click(enviar);
    await waitFor(() =>
      expect(servicio.conformidad).toHaveBeenCalledWith(
        43,
        "observacion",
        "Faltan horas extra.",
      ),
    );
  });

  it("si Talento Humano corrigió su rol, se lo dice y lo lleva a confirmar", async () => {
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      por_confirmar: [
        { id: 5, anio: 2026, mes: 8, nota: "Se sumaron las horas extra." },
      ],
    });
    render(<RolPagosPage />);
    const aviso = await screen.findByRole("region", {
      name: "Correcciones por confirmar",
    });
    expect(
      within(aviso).getByText(/Se sumaron las horas extra/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(aviso).getByRole("button", { name: "Revisar y confirmar" }),
    );
    expect(
      screen.getByRole("dialog", {
        name: "Confirmar consulta del rol de pagos",
      }),
    ).toHaveTextContent(/Agosto de 2026/);
  });

  it("con permiso, el historial por código muestra consultas, conformidad y observación", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_ver_historial: true });
    servicio.historial.mockResolvedValue({
      codigo: "20100001",
      persona: {
        id: 9,
        nombre: "Juan Diego Almachi",
        correo: "j@grupolaar.com",
      },
      periodos: [
        {
          anio: 2026,
          mes: 9,
          desde: "01/09/2026",
          hasta: "30/09/2026",
          consultas: [
            {
              id: 1,
              por: "Juan Diego Almachi",
              propia: true,
              consultada: {
                dia: "martes",
                fecha: "21/10/2026",
                hora: "10:30:00",
              },
              ip: "10.0.0.5",
              conformidad: "conforme",
              conformidad_display: "Estuvo de acuerdo",
              conformidad_en: {
                dia: "martes",
                fecha: "21/10/2026",
                hora: "10:32:05",
              },
              conformidad_ip: "10.0.0.5",
            },
          ],
          observacion: {
            estado: "cerrada",
            estado_display: "Confirmada",
            mensajes: [
              {
                tipo: "observacion",
                tipo_display: "Observación",
                autor: "Juan Diego Almachi",
                texto: "Faltan horas extra.",
                momento: {
                  dia: "lunes",
                  fecha: "20/10/2026",
                  hora: "09:00:00",
                },
              },
            ],
          },
        },
      ],
    });
    render(<RolPagosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Historial por empleado/ }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Historial de roles de pagos",
    });
    fireEvent.change(within(ventana).getByLabelText("Código de empleado"), {
      target: { value: "20100001" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /Buscar/ }));
    await waitFor(() =>
      expect(servicio.historial).toHaveBeenCalledWith("20100001"),
    );
    expect(
      await within(ventana).findByText("Estuvo de acuerdo"),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText("martes 21/10/2026 10:32:05"),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText("Faltan horas extra."),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText(/Observación · Confirmada/),
    ).toBeInTheDocument();
  });

  it("sin permiso no aparece el botón del historial", async () => {
    render(<RolPagosPage />);
    await screen.findByLabelText("Código de empleado");
    expect(
      screen.queryByRole("button", { name: /Historial por empleado/ }),
    ).toBeNull();
  });

  it("quien no está habilitado no ve la consulta y sabe por qué", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, habilitado: false });
    render(<RolPagosPage />);
    expect(
      await screen.findByText(/no está habilitada para consultar/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Período a consultar" }),
    ).toBeNull();
  });

  it("muestra sus propias observaciones, en todos sus estados", async () => {
    servicio.misObservaciones.mockResolvedValue([
      {
        id: 4,
        anio: 2026,
        mes: 8,
        estado: "cerrada",
        estado_display: "Cerrada",
        ultima: "Faltan horas.",
        mensajes: [
          {
            id: 1,
            tipo: "observacion",
            tipo_display: "Observación",
            autor: "Rosa",
            texto: "Faltan horas.",
            fecha: "2026-09-02T15:00:00Z",
          },
        ],
      },
    ]);
    render(<RolPagosPage />);
    const seccion = await screen.findByRole("region", {
      name: "Mis observaciones",
    });
    expect(within(seccion).getByText("Cerrada")).toBeInTheDocument();
  });

  it("nómina habilita a una persona con su código", async () => {
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      habilitado: false,
      puede_habilitar: true,
    });
    servicio.habilitados.mockResolvedValue([
      {
        id: 9,
        nombre: "Rosa Vera",
        correo: "r@x.com",
        codigo: "",
        habilitado: false,
      },
    ]);
    servicio.habilitar.mockResolvedValue({
      id: 9,
      nombre: "Rosa Vera",
      correo: "r@x.com",
      codigo: "20100001",
      habilitado: true,
    });
    render(<RolPagosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Usuarios habilitados/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Usuarios habilitados",
    });
    fireEvent.change(
      await within(ventana).findByLabelText("Código de empleado de Rosa Vera"),
      { target: { value: "20100001" } },
    );
    fireEvent.click(within(ventana).getByLabelText("Habilitar a Rosa Vera"));
    await waitFor(() =>
      expect(servicio.habilitar).toHaveBeenCalledWith({
        usuario: 9,
        habilitado: true,
        codigo: "20100001",
      }),
    );
  });

  it("sin permiso no aparece la descarga masiva", async () => {
    render(<RolPagosPage />);
    await screen.findByLabelText("Código de empleado");
    expect(
      screen.queryByRole("button", { name: /Descarga masiva/ }),
    ).not.toBeInTheDocument();
  });

  it("Talento Humano descarga los roles de un área en un ZIP", async () => {
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      puede_descarga_masiva: true,
    });
    servicio.areasDescargaMasiva.mockResolvedValue([
      { id: 3, nombre: "Comercial", nivel: "Área", personas: 3, con_codigo: 2 },
      { id: 4, nombre: "Bodega", nivel: "Área", personas: 1, con_codigo: 0 },
    ]);
    const zip = new Blob(["PK"]);
    servicio.descargaMasiva.mockResolvedValue({
      blob: zip,
      incluidos: 2,
      omitidos: 1,
    });
    render(<RolPagosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Descarga masiva/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Descarga masiva",
    });
    // Un área sin nadie con código no se puede elegir.
    expect(
      await within(ventana).findByRole("option", { name: /Bodega/ }),
    ).toBeDisabled();
    fireEvent.change(within(ventana).getByLabelText("Área"), {
      target: { value: "3" },
    });
    fireEvent.change(within(ventana).getByLabelText("Año"), {
      target: { value: "2025" },
    });
    fireEvent.change(within(ventana).getByLabelText("Mes"), {
      target: { value: "9" },
    });
    fireEvent.change(within(ventana).getByLabelText("Confirme su contraseña"), {
      target: { value: "clave" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /Descargar/ }));
    await waitFor(() =>
      expect(servicio.descargaMasiva).toHaveBeenCalledWith({
        unidad: 3,
        anio: 2025,
        mes: 9,
        password: "clave",
      }),
    );
    expect(descargarBlob).toHaveBeenCalledWith(
      zip,
      "Roles de pago - Comercial - Septiembre 2025.zip",
    );
    expect(await within(ventana).findByRole("status")).toHaveTextContent(
      "2 rol(es) de pagos · 1 sin rol",
    );
  });

  it("sin permiso no aparece «Roles sin abrir»", async () => {
    render(<RolPagosPage />);
    await screen.findByLabelText("Código de empleado");
    expect(
      screen.queryByRole("button", { name: /Roles sin abrir/ }),
    ).not.toBeInTheDocument();
  });

  it("Talento Humano ve quién no abrió su rol y cómo contactarlo", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_seguimiento: true });
    servicio.resumenSeguimiento.mockResolvedValue([
      {
        anio: 2025,
        mes: 9,
        habilitados: 4,
        abiertos: 2,
        aceptados: 1,
        con_observacion: 0,
        sin_aceptar: 1,
        sin_abrir: 2,
        pendientes: 3,
      },
    ]);
    servicio.seguimiento.mockResolvedValue({
      ...SEGUIMIENTO,
      sin_abrir: [
        {
          id: 1,
          nombre: "Beto Paz",
          codigo: "200",
          cargo: "Analista",
          area: "Comercial",
          correo: "bpaz@grupolaar.com",
          telefono: "0999999999",
          ultima_apertura: { fecha: "05/08/2025" },
        },
        {
          id: 2,
          nombre: "Carla Ruiz",
          codigo: "300",
          cargo: "",
          area: "",
          correo: "cruiz@grupolaar.com",
          telefono: "",
          ultima_apertura: null,
        },
      ],
      aceptados: [
        {
          id: 3,
          nombre: "Ana Mora",
          codigo: "100",
          cargo: "",
          area: "",
          correo: "amora@grupolaar.com",
          telefono: "",
          abierto: {
            dia: "jueves",
            fecha: "02/10/2025",
            hora: "09:15:00",
            ip: "10.0.0.5",
          },
          veces: 1,
          conformidad: "conforme",
          conformidad_display: "Estuvo de acuerdo",
          conformidad_en: {
            dia: "jueves",
            fecha: "02/10/2025",
            hora: "09:20:00",
            ip: "10.0.0.6",
          },
        },
      ],
      totales: {
        sin_abrir: 2,
        sin_aceptar: 1,
        con_observacion: 0,
        aceptados: 1,
      },
      habilitados: 4,
    });
    render(<RolPagosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Roles sin abrir/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Roles sin abrir",
    });
    // El resumen del año, mes por mes.
    const resumen = await within(ventana).findByRole("table", {
      name: /Resumen de/,
    });
    const septiembre = within(resumen)
      .getByRole("button", { name: "Septiembre" })
      .closest("tr");
    expect(
      within(septiembre)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["Septiembre", "4", "2", "1", "0", "1", "2"]);

    expect(await within(ventana).findByText("Beto Paz")).toBeInTheDocument();
    expect(within(ventana).getByText(/3 pendiente\(s\)/)).toBeInTheDocument();
    expect(
      within(ventana).getByText("Analista · Comercial"),
    ).toBeInTheDocument();
    expect(within(ventana).getByText("0999999999")).toBeInTheDocument();
    expect(
      within(ventana).queryByRole("button", {
        name: "Copiar el teléfono de Carla Ruiz",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(ventana).getByText("Nunca ha abierto uno"),
    ).toBeInTheDocument();
    expect(within(ventana).queryByText("Ana Mora")).not.toBeInTheDocument();
    // Sin `roles_pago.historial` no se ve el rol de cada persona.
    expect(
      within(ventana).queryByRole("button", { name: /Ver el rol de/ }),
    ).not.toBeInTheDocument();

    fireEvent.change(within(ventana).getByLabelText("Buscar"), {
      target: { value: "carla" },
    });
    expect(within(ventana).queryByText("Beto Paz")).not.toBeInTheDocument();
    fireEvent.change(within(ventana).getByLabelText("Buscar"), {
      target: { value: "" },
    });

    fireEvent.click(
      within(ventana).getByRole("button", { name: "Aceptados (1)" }),
    );
    expect(within(ventana).getByText("Ana Mora")).toBeInTheDocument();
    expect(
      within(ventana).getByText(
        /Abierto y términos aceptados · jueves 02\/10\/2025 · 09:15 · IP 10\.0\.0\.5/,
      ),
    ).toBeInTheDocument();
  });

  it("exporta los pendientes a Excel y les manda un recordatorio", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_seguimiento: true });
    servicio.resumenSeguimiento.mockResolvedValue([]);
    servicio.seguimiento.mockResolvedValue({
      ...SEGUIMIENTO,
      totales: {
        sin_abrir: 2,
        sin_aceptar: 1,
        con_observacion: 0,
        aceptados: 0,
      },
      habilitados: 3,
    });
    const excel = new Blob(["xlsx"]);
    servicio.exportarSeguimiento.mockResolvedValue(excel);
    servicio.recordarPendientes.mockResolvedValue({ enviadas: 3 });
    render(<RolPagosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Roles sin abrir/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Roles sin abrir",
    });
    fireEvent.click(
      await within(ventana).findByRole("button", {
        name: /Exportar pendientes \(3\)/,
      }),
    );
    await waitFor(() =>
      expect(descargarBlob).toHaveBeenCalledWith(
        excel,
        "roles-2026-09-pendientes.xlsx",
      ),
    );
    expect(servicio.exportarSeguimiento).toHaveBeenCalledWith(
      2026,
      9,
      "pendientes",
    );

    // El recordatorio pide confirmación antes de salir.
    fireEvent.click(
      within(ventana).getByRole("button", {
        name: /Recordar a los pendientes/,
      }),
    );
    expect(servicio.recordarPendientes).not.toHaveBeenCalled();
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Sí, enviar" }),
    );
    expect(
      await within(ventana).findByText(/Se envió el recordatorio a 3 persona/),
    ).toBeInTheDocument();
    expect(servicio.recordarPendientes).toHaveBeenCalledWith(2026, 9);
  });

  it("con el historial se ve el rol de cada persona para validarlo", async () => {
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      puede_seguimiento: true,
      puede_ver_historial: true,
    });
    servicio.resumenSeguimiento.mockResolvedValue([]);
    servicio.seguimiento.mockResolvedValue({
      ...SEGUIMIENTO,
      sin_abrir: [
        {
          id: 1,
          nombre: "Beto Paz",
          codigo: "200",
          cargo: "",
          area: "",
          correo: "bpaz@grupolaar.com",
          telefono: "",
          ultima_apertura: null,
        },
      ],
      totales: {
        sin_abrir: 1,
        sin_aceptar: 0,
        con_observacion: 0,
        aceptados: 0,
      },
      habilitados: 1,
    });
    servicio.rolDelHistorial.mockResolvedValue(new Blob(["%PDF"]));
    render(<RolPagosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Roles sin abrir/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Roles sin abrir",
    });
    fireEvent.click(
      await within(ventana).findByRole("button", {
        name: "Ver el rol de Beto Paz",
      }),
    );
    fireEvent.change(
      within(ventana).getByLabelText(
        "Su contraseña para ver el rol de Beto Paz",
      ),
      { target: { value: "clave" } },
    );
    fireEvent.click(within(ventana).getByRole("button", { name: "Ver" }));
    await waitFor(() =>
      expect(servicio.rolDelHistorial).toHaveBeenCalledWith({
        codigo: "200",
        anio: 2026,
        mes: 9,
        password: "clave",
      }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: /Rol de pagos · Beto Paz · Septiembre 2026/,
      }),
    ).toBeInTheDocument();
  });

  it("cambiar el mes vuelve a pedir la lista", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_seguimiento: true });
    servicio.resumenSeguimiento.mockResolvedValue([]);
    servicio.seguimiento.mockResolvedValue(SEGUIMIENTO);
    render(<RolPagosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Roles sin abrir/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Roles sin abrir",
    });
    expect(
      await within(ventana).findByText(
        /Todas las personas habilitadas ya abrieron/,
      ),
    ).toBeInTheDocument();
    fireEvent.change(within(ventana).getByLabelText("Año"), {
      target: { value: "2025" },
    });
    fireEvent.change(within(ventana).getByLabelText("Mes"), {
      target: { value: "3" },
    });
    await waitFor(() =>
      expect(servicio.seguimiento).toHaveBeenLastCalledWith(2025, 3),
    );
    expect(servicio.resumenSeguimiento).toHaveBeenCalledWith(2025);
  });

  it("la persona ve cuándo abrió cada rol y cuándo dio su conformidad", async () => {
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      mis_roles: [
        {
          anio: 2026,
          mes: 9,
          veces: 2,
          abierto: {
            dia: "lunes",
            fecha: "26/10/2026",
            hora: "14:43:10",
            ip: "10.0.2.80",
          },
          conformidad: "conforme",
          conformidad_display: "Estuvo de acuerdo",
          conformidad_en: {
            dia: "lunes",
            fecha: "26/10/2026",
            hora: "14:45:00",
            ip: "10.0.2.80",
          },
        },
        {
          anio: 2026,
          mes: 8,
          veces: 1,
          abierto: {
            dia: "martes",
            fecha: "01/09/2026",
            hora: "08:00:00",
            ip: "10.0.2.81",
          },
          conformidad: "",
          conformidad_display: "",
          conformidad_en: null,
        },
      ],
    });
    render(<RolPagosPage />);
    const lista = await screen.findByRole("region", {
      name: "Mis roles abiertos",
    });
    expect(within(lista).getByText("Septiembre 2026")).toBeInTheDocument();
    expect(
      within(lista).getByText(
        /Abierto y términos aceptados · martes 01\/09\/2026 · 08:00 · IP 10\.0\.2\.81/,
      ),
    ).toBeInTheDocument();
    expect(
      within(lista).getByText(/Estuvo de acuerdo · lunes 26\/10\/2026 · 14:45/),
    ).toBeInTheDocument();
    expect(
      within(lista).getByText(/Conformidad pendiente/),
    ).toBeInTheDocument();
  });

  it("Talento Humano descarga el rol auditado de varios meses en un ZIP", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_ver_historial: true });
    servicio.personaAuditada.mockResolvedValue({
      codigo: "100",
      persona: { id: 3, nombre: "Ana Mora", correo: "amora@grupolaar.com" },
      con_movimientos: [
        { anio: 2025, mes: 6 },
        { anio: 2025, mes: 4 },
      ],
    });
    const zip = new Blob(["PK"]);
    servicio.rolAuditado.mockResolvedValue({
      blob: zip,
      incluidos: 2,
      omitidos: 0,
    });
    render(<RolPagosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar rol auditado/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Descargar rol auditado",
    });
    fireEvent.change(within(ventana).getByLabelText("Código de empleado"), {
      target: { value: "100" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /Buscar/ }));
    expect(await within(ventana).findByText("Ana Mora")).toBeInTheDocument();
    // Abre en el año del último mes con movimientos y se puede filtrar.
    expect(within(ventana).getByLabelText("Año")).toHaveValue("2025");
    fireEvent.click(
      within(ventana).getByLabelText("Solo meses con movimientos"),
    );
    expect(within(ventana).queryByLabelText("Mayo")).not.toBeInTheDocument();
    fireEvent.click(within(ventana).getByLabelText(/Abril/));
    fireEvent.click(within(ventana).getByLabelText(/Junio/));
    expect(
      within(ventana).getByText(/Abril 2025, Junio 2025/),
    ).toBeInTheDocument();
    fireEvent.change(within(ventana).getByLabelText("Confirme su contraseña"), {
      target: { value: "clave" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Descargar ZIP \(2 PDF\)/ }),
    );
    await waitFor(() =>
      expect(servicio.rolAuditado).toHaveBeenCalledWith({
        codigo: "100",
        periodos: [
          { anio: 2025, mes: 4 },
          { anio: 2025, mes: 6 },
        ],
        password: "clave",
      }),
    );
    expect(descargarBlob).toHaveBeenCalledWith(
      zip,
      "Roles auditados - 100 - 2025-04 a 2025-06.zip",
    );
  });

  it("un solo mes baja como PDF", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_ver_historial: true });
    servicio.personaAuditada.mockResolvedValue({
      codigo: "100",
      persona: null,
      con_movimientos: [{ anio: 2025, mes: 4 }],
    });
    const pdf = new Blob(["%PDF"]);
    servicio.rolAuditado.mockResolvedValue({
      blob: pdf,
      incluidos: 1,
      omitidos: 0,
    });
    render(<RolPagosPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar rol auditado/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Descargar rol auditado",
    });
    fireEvent.change(within(ventana).getByLabelText("Código de empleado"), {
      target: { value: "100" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /Buscar/ }));
    fireEvent.click(await within(ventana).findByLabelText(/Abril/));
    fireEvent.change(within(ventana).getByLabelText("Confirme su contraseña"), {
      target: { value: "clave" },
    });
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Descargar PDF" }),
    );
    await waitFor(() =>
      expect(descargarBlob).toHaveBeenCalledWith(
        pdf,
        "Rol auditado - 100 - 2025-04 Abril.pdf",
      ),
    );
  });

  it("si ya aceptó ese mes, ve la aceptación y no se le vuelve a preguntar", async () => {
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 50,
      aceptado: {
        conformidad: "conforme",
        conformidad_display: "Estuvo de acuerdo",
        dia: "lunes",
        fecha: "05/10/2026",
        hora: "09:10:00",
        ip: "10.0.2.80",
      },
    });
    const ventana = await consultar();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.change(
      within(ventana).getByLabelText("Contraseña de su cuenta"),
      {
        target: { value: "secreta" },
      },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Ver rol de pagos" }),
    );
    const visor = await screen.findByRole("dialog", {
      name: "Rol de pagos · Septiembre 2026",
    });
    expect(within(visor).getByText("Estuvo de acuerdo")).toBeInTheDocument();
    expect(
      within(visor).getByText(/La aceptación es definitiva/),
    ).toBeInTheDocument();
    expect(
      within(visor).queryByRole("button", { name: /Estoy de acuerdo/ }),
    ).not.toBeInTheDocument();
    expect(
      within(visor).queryByRole("button", { name: /Tengo una observación/ }),
    ).not.toBeInTheDocument();
  });
});
