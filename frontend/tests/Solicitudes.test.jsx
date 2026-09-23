import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Solicitudes de compra: lo que falta, no lo que hay.
 *
 * Las dos bandejas son la misma lista mirada desde los dos lados —lo que pedí
 * y lo que me toca gestionar—, así que lo que se prueba es que cada una pida
 * su ámbito y enseñe la columna que importa. En la ficha, lo que se prueba es
 * que solo se ofrezcan los pasos que el servidor va a aceptar: un botón que
 * termina en 403 enseña a desconfiar de la pantalla.
 */

const listar = vi.fn();
const obtener = vi.fn();
const crear = vi.fn();
const cambiarEstado = vi.fn();
const encargados = vi.fn();
const catalogo = vi.fn();

vi.mock("../src/api/solicitudesService", () => ({
  solicitudesService: {
    list: (...args) => listar(...args),
    get: (...args) => obtener(...args),
    create: (...args) => crear(...args),
    cambiarEstado: (...args) => cambiarEstado(...args),
    encargados: (...args) => encargados(...args),
    catalogo: (...args) => catalogo(...args),
  },
}));

const permisos = new Set();
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codename) => permisos.has(codename),
}));

const sesion = { user: { id: 7, permissions: [] } };
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => sesion,
}));

vi.mock("react-router-dom", async () => {
  const real = await vi.importActual("react-router-dom");
  return { ...real, useParams: () => ({ id: "3" }) };
});

const { MisSolicitudes } =
  await import("../src/pages/Admin/Solicitudes/MisSolicitudes");
const { SolicitudesRecibidas } =
  await import("../src/pages/Admin/Solicitudes/SolicitudesRecibidas");
const { SolicitudForm } =
  await import("../src/pages/Admin/Solicitudes/SolicitudForm");
const { SolicitudDetalle } =
  await import("../src/pages/Admin/Solicitudes/SolicitudDetalle");

const SOLICITUDES = [
  {
    id: 3,
    solicitante: 7,
    solicitante_nombre: "Ana Rojas",
    encargado: 9,
    encargado_nombre: "Luis Torres",
    clase: "dispositivo",
    clase_display: "Dispositivo",
    lo_que_se_pide: "Laptop — con 32 GB para diseño",
    cantidad: 2,
    justificacion: "Entra un analista el 1 de octubre.",
    prioridad: "alta",
    prioridad_display: "Alta",
    fecha_necesaria: "2026-10-01",
    estado: "pendiente",
    estado_display: "Pendiente",
    esta_cerrada: false,
    created_at: "2026-09-15T10:00:00Z",
    movimientos: [
      {
        id: 1,
        estado_anterior: "",
        estado_nuevo: "pendiente",
        estado_nuevo_display: "Pendiente",
        actor_nombre: "Ana Rojas",
        nota: "Solicitud registrada.",
        created_at: "2026-09-15T10:00:00Z",
      },
    ],
  },
];

function pintar(Pantalla) {
  return render(
    <MemoryRouter>
      <Pantalla />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permisos.clear();
  sesion.user = { id: 7, permissions: [] };
  listar.mockResolvedValue({ results: SOLICITUDES, count: 1 });
  obtener.mockResolvedValue(SOLICITUDES[0]);
  crear.mockResolvedValue({ id: 12, aviso: { enviado_a: 1, sin_correo: [] } });
  cambiarEstado.mockResolvedValue({
    ...SOLICITUDES[0],
    estado: "en_gestion",
    estado_display: "En gestión",
  });
  // Sin correo: la API solo devuelve id y nombre (ver EncargadoSerializer).
  encargados.mockResolvedValue([{ id: 9, nombre: "Luis Torres" }]);
  catalogo.mockResolvedValue({
    tipos_dispositivo: [
      {
        id: 1,
        nombre: "Laptop",
        caracteristicas: [
          {
            id: 11,
            nombre: "RAM",
            dato: "entero",
            unidad: "GB",
            opciones: [],
            obligatoria: true,
            orden: 1,
          },
          {
            id: 12,
            nombre: "Tipo de disco",
            dato: "lista",
            unidad: "",
            opciones: ["HDD", "SSD", "NVMe"],
            obligatoria: true,
            orden: 2,
          },
        ],
      },
      { id: 2, nombre: "Impresora", caracteristicas: [] },
    ],
    componentes: [{ id: 5, nombre: "Disco SSD 480 GB" }],
  });
});

describe("Mis solicitudes", () => {
  it("pide lo que registré yo, y lo abierto primero", async () => {
    pintar(MisSolicitudes);

    await waitFor(() => expect(listar).toHaveBeenCalled());
    expect(listar.mock.calls[0][0]).toMatchObject({
      ambito: "mias",
      abiertas: "true",
    });
  });

  it("dice quién lo va a comprar, que es lo que uno espera saber", async () => {
    pintar(MisSolicitudes);

    const fila = (await screen.findByText(/Laptop — con 32 GB/)).closest("tr");
    expect(fila).toHaveTextContent("Luis Torres");
    expect(fila).toHaveTextContent("Pendiente");
    expect(fila).toHaveTextContent("Alta");
  });

  it("sin permiso de crear no se ofrece el formulario", async () => {
    pintar(MisSolicitudes);

    await screen.findByText(/Laptop — con 32 GB/);
    expect(
      screen.queryByRole("link", { name: "Realizar solicitud" }),
    ).not.toBeInTheDocument();
  });

  it("con permiso, el atajo está donde se mira la lista", async () => {
    permisos.add("solicitudes.crear");

    pintar(MisSolicitudes);

    expect(
      await screen.findByRole("link", { name: "Realizar solicitud" }),
    ).toHaveAttribute("href", "/admin/solicitudes/nueva");
  });

  it("vacía lo dice sin dejar la tabla muda", async () => {
    listar.mockResolvedValue({ results: [], count: 0 });

    pintar(MisSolicitudes);

    expect(
      await screen.findByText("Todavía no ha realizado ninguna solicitud"),
    ).toBeInTheDocument();
  });
});

describe("Solicitudes recibidas", () => {
  it("pide lo que me asignaron y dice quién lo pidió", async () => {
    pintar(SolicitudesRecibidas);

    await waitFor(() => expect(listar).toHaveBeenCalled());
    expect(listar.mock.calls[0][0]).toMatchObject({ ambito: "recibidas" });

    const fila = (await screen.findByText(/Laptop — con 32 GB/)).closest("tr");
    expect(fila).toHaveTextContent("Ana Rojas");
  });

  it("quien administra compras sabe que está viendo las de todos", async () => {
    permisos.add("solicitudes.administrar");

    pintar(SolicitudesRecibidas);

    expect(
      await screen.findByText(/las solicitudes de toda la empresa/i),
    ).toBeInTheDocument();
  });

  it("se puede mirar solo lo cerrado sin perder el filtro", async () => {
    pintar(SolicitudesRecibidas);

    await screen.findByText(/Laptop — con 32 GB/);
    fireEvent.change(screen.getByLabelText("Mostrar"), {
      target: { value: "false" },
    });

    await waitFor(() =>
      expect(listar).toHaveBeenLastCalledWith(
        expect.objectContaining({ abiertas: "false", ambito: "recibidas" }),
      ),
    );
  });
});

describe("Realizar una solicitud", () => {
  it("solo ofrece como encargado a quien puede atenderla", async () => {
    pintar(SolicitudForm);

    await waitFor(() => expect(encargados).toHaveBeenCalled());
    expect(
      await screen.findByRole("option", { name: "Luis Torres" }),
    ).toBeInTheDocument();
  });

  it("el catálogo sale de solicitudes, no del inventario", async () => {
    /* Quien solo pide no tiene permiso para ver el parque: por ahí el
       desplegable llegaría vacío por un 403 que nadie ve. */
    pintar(SolicitudForm);

    await waitFor(() => expect(catalogo).toHaveBeenCalled());
    expect(
      await screen.findByRole("option", { name: "Laptop" }),
    ).toBeInTheDocument();
  });

  it("al cambiar a componente se ofrecen los del catálogo de repuestos", async () => {
    pintar(SolicitudForm);

    await screen.findByRole("option", { name: "Laptop" });
    fireEvent.change(screen.getByLabelText("Qué necesita"), {
      target: { value: "componente" },
    });

    expect(
      await screen.findByRole("option", { name: "Disco SSD 480 GB" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Laptop" }),
    ).not.toBeInTheDocument();
  });

  it("elegir un tipo carga sus características, y no antes", async () => {
    /* Es lo que distingue «una laptop» de «una laptop con 32 GB y disco NVMe»,
       que son dos compras distintas. */
    pintar(SolicitudForm);

    await screen.findByRole("option", { name: "Laptop" });
    expect(screen.queryByLabelText(/RAM/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tipo de dispositivo"), {
      target: { value: "1" },
    });

    expect(await screen.findByLabelText(/RAM \(GB\)/)).toHaveAttribute(
      "type",
      "number",
    );
    expect(screen.getByRole("option", { name: "NVMe" })).toBeInTheDocument();
  });

  it("las que el tipo marca obligatorias hay que llenarlas", async () => {
    /* Lo declarado obligatorio se exige también al pedir: una solicitud que no
       dice la RAM de una laptop es una que habrá que devolver preguntando. */
    pintar(SolicitudForm);

    await screen.findByRole("option", { name: "Laptop" });
    fireEvent.change(screen.getByLabelText("Tipo de dispositivo"), {
      target: { value: "1" },
    });

    expect(await screen.findByLabelText(/RAM \(GB\)/)).toBeRequired();
    expect(screen.getByLabelText(/Tipo de disco/)).toBeRequired();
  });

  it("un tipo sin características no pinta la sección", async () => {
    pintar(SolicitudForm);

    await screen.findByRole("option", { name: "Impresora" });
    fireEvent.change(screen.getByLabelText("Tipo de dispositivo"), {
      target: { value: "2" },
    });

    await waitFor(() =>
      expect(
        screen.queryByText("Con qué características"),
      ).not.toBeInTheDocument(),
    );
  });

  it("las características viajan con la solicitud", async () => {
    pintar(SolicitudForm);

    await screen.findByRole("option", { name: "Luis Torres" });
    fireEvent.change(screen.getByLabelText("Tipo de dispositivo"), {
      target: { value: "1" },
    });
    fireEvent.change(await screen.findByLabelText(/RAM \(GB\)/), {
      target: { value: "32" },
    });
    fireEvent.change(screen.getByLabelText(/Tipo de disco/), {
      target: { value: "NVMe" },
    });
    fireEvent.change(screen.getByLabelText("Quién realizará la compra"), {
      target: { value: "9" },
    });
    fireEvent.change(screen.getByLabelText("Para qué hace falta"), {
      target: { value: "Entra un analista." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0].especificaciones).toEqual({
      RAM: "32",
      "Tipo de disco": "NVMe",
    });
  });

  it("cambiar de tipo no arrastra las características del anterior", async () => {
    /* Las de una laptop no describen una impresora, y el servidor rechazaría
       lo que llegara de más sin que se vea por qué. */
    pintar(SolicitudForm);

    await screen.findByRole("option", { name: "Laptop" });
    fireEvent.change(screen.getByLabelText("Tipo de dispositivo"), {
      target: { value: "1" },
    });
    fireEvent.change(await screen.findByLabelText(/RAM \(GB\)/), {
      target: { value: "32" },
    });
    fireEvent.change(screen.getByLabelText("Tipo de dispositivo"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Quién realizará la compra"), {
      target: { value: "9" },
    });
    fireEvent.change(screen.getByLabelText("Para qué hace falta"), {
      target: { value: "La bodega imprime a mano." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0].especificaciones).toEqual({});
  });

  it("lo que se pide viaja con su encargado y su justificación", async () => {
    pintar(SolicitudForm);

    await screen.findByRole("option", { name: "Luis Torres" });
    fireEvent.change(screen.getByLabelText("Tipo de dispositivo"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Quién realizará la compra"), {
      target: { value: "9" },
    });
    fireEvent.change(screen.getByLabelText("Para qué hace falta"), {
      target: { value: "La bodega imprime a mano." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));

    await waitFor(() => expect(crear).toHaveBeenCalled());
    expect(crear.mock.calls[0][0]).toMatchObject({
      encargado: 9,
      tipo_dispositivo: 2,
      justificacion: "La bodega imprime a mano.",
      clase: "dispositivo",
    });
    // Lo que se pide sale del catálogo: ya no viaja un texto suelto.
    expect(crear.mock.calls[0][0]).not.toHaveProperty("detalle");
  });

  it("lo que se pide se elige del catálogo, no se escribe", async () => {
    /* El texto libre dejaba «laptop», «Laptop» y «portátil» para lo mismo, y no
       traía las características con las que se describe el pedido. */
    pintar(SolicitudForm);

    await screen.findByRole("option", { name: "Laptop" });
    expect(
      screen.queryByLabelText("Qué se necesita exactamente"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Tipo de dispositivo")).toBeRequired();
  });

  it("si al encargado no se le pudo avisar, se dice antes de salir", async () => {
    /* Quien pide debe saberlo ahora, no cuando pregunte por qué nadie la
       atendió. */
    crear.mockResolvedValue({
      id: 12,
      aviso: { enviado_a: 0, sin_correo: ["Luis Torres"] },
    });

    pintar(SolicitudForm);

    await screen.findByRole("option", { name: "Luis Torres" });
    fireEvent.change(screen.getByLabelText("Tipo de dispositivo"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Quién realizará la compra"), {
      target: { value: "9" },
    });
    fireEvent.change(screen.getByLabelText("Para qué hace falta"), {
      target: { value: "Sala de juntas" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));

    expect(
      await screen.findByText(/no se pudo avisar por correo/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Luis Torres/)).toBeInTheDocument();
  });
});

describe("La ficha de una solicitud", () => {
  it("muestra el recorrido con quién dio cada paso", async () => {
    pintar(SolicitudDetalle);

    expect(
      await screen.findByText("Solicitud registrada."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pendiente", { selector: "strong" }),
    ).toBeInTheDocument();
  });

  it("enseña con qué características se pidió", async () => {
    obtener.mockResolvedValue({
      ...SOLICITUDES[0],
      especificaciones: { RAM: 32, "Tipo de disco": "NVMe" },
    });

    pintar(SolicitudDetalle);

    expect(
      await screen.findByText("Con qué características"),
    ).toBeInTheDocument();
    expect(screen.getByText("RAM")).toBeInTheDocument();
    expect(screen.getByText("32")).toBeInTheDocument();
    expect(screen.getByText("NVMe")).toBeInTheDocument();
  });

  it("sin características pedidas no aparece esa sección", async () => {
    pintar(SolicitudDetalle);

    await screen.findByText("Solicitud registrada.");
    expect(
      screen.queryByText("Con qué características"),
    ).not.toBeInTheDocument();
  });

  it("quien la pidió no ve los pasos de quien la gestiona", async () => {
    pintar(SolicitudDetalle);

    await screen.findByText("Solicitud registrada.");
    expect(
      screen.queryByRole("button", { name: "Tomarla" }),
    ).not.toBeInTheDocument();
  });

  it("pero sí puede retirarla", async () => {
    /* Dejar abierta una solicitud que ya no hace falta le hace perder el
       tiempo a quien compra. */
    pintar(SolicitudDetalle);

    fireEvent.click(
      await screen.findByRole("button", { name: "Cancelar la solicitud" }),
    );

    await waitFor(() => expect(cambiarEstado).toHaveBeenCalled());
    expect(cambiarEstado.mock.calls[0].slice(0, 2)).toEqual([3, "cancelada"]);
  });

  it("el encargado ve solo los pasos que el servidor acepta", async () => {
    sesion.user = { id: 9, permissions: [] };
    permisos.add("solicitudes.gestionar");

    pintar(SolicitudDetalle);

    expect(
      await screen.findByRole("button", { name: "Tomarla" }),
    ).toBeInTheDocument();
    // Desde «pendiente» no se llega a comprada ni entregada: comprada ya costó
    // dinero, y no se llega ahí sin haberla tomado.
    expect(
      screen.queryByRole("button", { name: "Marcar como entregada" }),
    ).not.toBeInTheDocument();
  });

  it("rechazar sin motivo se ataja antes de enviarlo", async () => {
    sesion.user = { id: 9, permissions: [] };
    permisos.add("solicitudes.gestionar");

    pintar(SolicitudDetalle);

    fireEvent.click(await screen.findByRole("button", { name: "Rechazar" }));

    expect(await screen.findByText(/lleva motivo/)).toBeInTheDocument();
    expect(cambiarEstado).not.toHaveBeenCalled();
  });

  it("una cerrada no ofrece nada y dice por qué", async () => {
    obtener.mockResolvedValue({
      ...SOLICITUDES[0],
      estado: "entregada",
      estado_display: "Entregada",
      esta_cerrada: true,
    });
    sesion.user = { id: 9, permissions: [] };
    permisos.add("solicitudes.gestionar");

    pintar(SolicitudDetalle);

    expect(await screen.findByText(/no se reabre/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tomarla" }),
    ).not.toBeInTheDocument();
  });
});
