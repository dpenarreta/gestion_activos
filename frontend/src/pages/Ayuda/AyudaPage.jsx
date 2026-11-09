import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { queSigue } from "../Soporte/comunes";

import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import { usePermission } from "../../hooks/usePermission";
import { MisSolicitudes } from "../Soporte/Bandeja";
import { NuevoTicket } from "./NuevoTicket";
import "../Soporte/Soporte.css";

/*
 * «Mis tickets» es la misma lista que «Mis solicitudes» de la bandeja
 * (revisión final UX/UI, 28/10/2026): antes era una tabla propia que se veía
 * vacía mientras cargaba, mostraba el error sin reintentar y apretaba cuatro
 * columnas en el teléfono. La lista común tiene cargando, error con
 * «Reintentar», vacío y tarjetas en móvil.
 */
const PESTANAS = [
  { id: "nuevo", etiqueta: "Nuevo ticket" },
  { id: "mios", etiqueta: "Mis tickets" },
];

/** El permiso para crear tickets a su nombre (09/11/2026). */
export const PERMISO_CREAR_TICKETS = "soporte.crear";

/**
 * Encima de «Mis tickets», a quien no tiene «Crear tickets» (auditoría UX/UI,
 * 09/11/2026): una nota en texto normal que dice qué permiso le falta y a
 * quién pedírselo. No es un aviso que se anuncie: no cambia nada en pantalla.
 */
export function SinPermisoParaCrear() {
  return (
    <p className="mb-0">
      Para crear tickets a su nombre necesita el permiso «Crear tickets»;
      pídaselo a su jefe o a Tecnología.
    </p>
  );
}

/**
 * «Soporte TI»: crear tickets a su nombre pide `soporte.crear` (09/11/2026);
 * sin él no hay pestaña «Nuevo ticket»: se abre siempre «Mis tickets», con una
 * nota de a quién pedir el permiso. Seguir sus tickets lo puede toda persona
 * con sesión. Los datos de contacto salen de «Mi perfil». (Desde
 * el 20/10/2026 no hay formulario público.)
 *
 * La pestaña va en la dirección (`?vista=mios`): así el enlace «Pedir ayuda
 * en Soporte TI» de la lista vacía, que lleva a `/admin/ayuda`, vuelve a
 * «Nuevo ticket» en vez de no hacer nada.
 */
export function AyudaPage() {
  const puedeCrear = usePermission(PERMISO_CREAR_TICKETS);
  const [parametros, setParametros] = useSearchParams();
  const pestana =
    !puedeCrear || parametros.get("vista") === "mios" ? "mios" : "nuevo";
  // Cuántos tickets le piden algo: se dice en la pestaña (antes, quien
  // entraba a «Nuevo ticket» no se enteraba de que soporte le preguntó).
  const [pendientes, setPendientes] = useState(0);
  const contar = (lista) =>
    setPendientes((lista ?? []).filter((t) => queSigue(t).accion).length);
  // En «Nuevo ticket» se pide la lista solo para contar; en «Mis tickets»
  // cuenta la propia lista al cargar.
  useEffect(() => {
    if (pestana !== "nuevo") return;
    Promise.resolve(soporteService.misTickets?.())
      .then(contar)
      .catch(() => setPendientes(0));
  }, [pestana]);
  const opciones = PESTANAS.map((p) =>
    p.id === "mios"
      ? { ...p, cuenta: pendientes, unidad: "necesitan algo de usted" }
      : p,
  );

  function cambiar(id) {
    setParametros(id === "mios" ? { vista: "mios" } : {}, { replace: true });
  }

  return (
    <div className="soporte-page mz-stack">
      <div className="mz-view-head">
        <div>
          {/* La barra ya dice «Soporte TI»: el título dice para qué sirve
              (antes se repetía). */}
          <h2>¿Necesita ayuda con tecnología?</h2>
          <p className="mz-desc">
            {puedeCrear
              ? "Cuéntenos qué pasa y el equipo de TI le ayuda. Aquí también sigue sus tickets."
              : "Aquí sigue los tickets que pidió al equipo de TI."}
          </p>
        </div>
      </div>
      {/* Pestañas comunes: flechas, una parada de Tab y panel asociado
          (revisión final UX/UI, 28/10/2026). Con una sola, no hay pestañas. */}
      {puedeCrear ? (
        <>
          <Pestanas
            etiqueta="Soporte TI"
            idBase="ayuda"
            valor={pestana}
            onCambio={cambiar}
            opciones={opciones}
          />
          <PanelDePestana idBase="ayuda" valor={pestana}>
            {pestana === "mios" ? (
              <MisSolicitudes onCargados={contar} puedeCrear />
            ) : (
              <NuevoTicket />
            )}
          </PanelDePestana>
        </>
      ) : (
        <>
          <SinPermisoParaCrear />
          <MisSolicitudes onCargados={contar} puedeCrear={false} />
        </>
      )}
    </div>
  );
}
