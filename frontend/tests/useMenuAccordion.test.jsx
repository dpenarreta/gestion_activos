import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ACCORDION_SESSION_STORAGE_KEY } from "../src/components/admin/AdminSidebar/adminMenuAccordionConfig";
import { useMenuAccordion } from "../src/hooks/useMenuAccordion";

const MENU = [
  {
    id: "activos",
    name: "Activos",
    children: [
      { id: "inventario", name: "Inventario", path: "/admin/activos" },
      { id: "escaner", name: "Escáner", path: "/admin/activos/escaner" },
    ],
  },
  {
    id: "organizacion",
    name: "Organización",
    children: [
      { id: "sedes", name: "Sedes", path: "/admin/organizacion/sedes" },
      {
        id: "empleados",
        name: "Empleados",
        path: "/admin/organizacion/empleados",
      },
    ],
  },
  {
    id: "mantenimientos",
    name: "Mantenimientos",
    children: [
      { id: "bitacora", name: "Bitácora", path: "/admin/mantenimientos" },
    ],
  },
  { id: "reportes", name: "Reportes", path: "/admin/reportes" },
];

const HERMANOS = MENU.map((item) => item.id);

function abrir(ruta = "/admin/reportes") {
  return renderHook(({ path }) => useMenuAccordion(MENU, path), {
    initialProps: { path: ruta },
  });
}

describe("Acordeón del menú administrativo", () => {
  beforeEach(() => sessionStorage.clear());

  it("abrir un grupo cierra el que estuviera abierto", async () => {
    /* Con varios abiertos hay que recorrer el menú entero para encontrar una
       sección, que es justo lo que el acordeón evita. */
    const { result } = abrir();

    await act(async () => result.current.toggle("activos", HERMANOS));
    expect(result.current.isExpanded("activos")).toBe(true);

    await act(async () => result.current.toggle("organizacion", HERMANOS));

    expect(result.current.isExpanded("organizacion")).toBe(true);
    expect(result.current.isExpanded("activos")).toBe(false);
  });

  it("volver a pulsar el grupo abierto lo cierra", async () => {
    const { result } = abrir();

    await act(async () => result.current.toggle("activos", HERMANOS));
    await act(async () => result.current.toggle("activos", HERMANOS));

    expect(result.current.isExpanded("activos")).toBe(false);
  });

  it("navegar a otra sección cierra la anterior", async () => {
    /* Era el hueco: el acordeón solo se cumplía al abrir a mano. Al navegar,
       la sección de destino se sumaba a las ya abiertas, así que bastaba con
       pasar por dos para acabar con medio menú desplegado sin haber pulsado
       ningún grupo. */
    const { result, rerender } = abrir("/admin/activos");

    expect(result.current.isExpanded("activos")).toBe(true);

    await act(async () => rerender({ path: "/admin/organizacion/sedes" }));

    expect(result.current.isExpanded("organizacion")).toBe(true);
    expect(result.current.isExpanded("activos")).toBe(false);
  });

  it("no reabre nada al navegar a una sección sin grupo", async () => {
    /* «Reportes» cuelga de la raíz: llegar ahí no dice nada sobre qué grupo
       debería estar abierto, y cerrarlo todo perdería el sitio de quien
       acababa de abrir uno. */
    const { result, rerender } = abrir("/admin/activos");

    await act(async () => rerender({ path: "/admin/reportes" }));

    expect(result.current.isExpanded("activos")).toBe(true);
  });

  it("al recargar restaura un solo grupo, no los que quedaran guardados", async () => {
    /* Una sesión anterior pudo guardar varios: restaurarlos devolvería el menú
       con dos grupos desplegados sin que nadie los abriera. */
    sessionStorage.setItem(
      ACCORDION_SESSION_STORAGE_KEY,
      JSON.stringify(["activos", "organizacion", "mantenimientos"]),
    );

    const { result } = abrir();

    const abiertos = HERMANOS.filter((id) => result.current.isExpanded(id));
    expect(abiertos).toEqual(["activos"]);
  });
});
