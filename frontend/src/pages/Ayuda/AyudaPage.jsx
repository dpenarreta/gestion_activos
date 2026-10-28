import { useSearchParams } from "react-router-dom";

import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
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

/**
 * «Soporte TI»: para toda persona con sesión, sin permisos. Pide soporte con
 * sus datos de «Mi perfil» y sigue sus tickets. (Desde el 20/10/2026 no hay
 * formulario público.)
 *
 * La pestaña va en la dirección (`?vista=mios`): así el enlace «Pedir ayuda
 * en Soporte TI» de la lista vacía, que lleva a `/admin/ayuda`, vuelve a
 * «Nuevo ticket» en vez de no hacer nada.
 */
export function AyudaPage() {
  const [parametros, setParametros] = useSearchParams();
  const pestana = parametros.get("vista") === "mios" ? "mios" : "nuevo";

  function cambiar(id) {
    setParametros(id === "mios" ? { vista: "mios" } : {}, { replace: true });
  }

  return (
    <div className="soporte-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Soporte TI</h2>
          <p className="mz-desc">
            Pida ayuda al equipo de tecnología y siga sus tickets.
          </p>
        </div>
      </div>
      {/* Pestañas comunes: flechas, una parada de Tab y panel asociado
          (revisión final UX/UI, 28/10/2026). */}
      <Pestanas
        etiqueta="Soporte TI"
        idBase="ayuda"
        valor={pestana}
        onCambio={cambiar}
        opciones={PESTANAS}
      />
      <PanelDePestana idBase="ayuda" valor={pestana}>
        {pestana === "nuevo" ? <NuevoTicket /> : <MisSolicitudes />}
      </PanelDePestana>
    </div>
  );
}
