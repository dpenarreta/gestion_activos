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
};
vi.mock("../src/api/nominaService", () => ({ nominaService: servicio }));
vi.mock("../src/components/common/VisorPdf/VisorPdf", () => ({
  MarcoPdf: () => <div />,
  useUrlDePdf: () => "blob:rol",
}));

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
};

beforeEach(() => {
  vi.clearAllMocks();
  servicio.estado.mockResolvedValue(ESTADO);
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
});
