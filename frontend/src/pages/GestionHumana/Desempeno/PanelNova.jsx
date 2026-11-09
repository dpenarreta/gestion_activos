/*
 * «Análisis de Nova» en los KPI de una persona (en Nexo, «Nova insights»).
 * Se pide a mano (cada pedido cuenta para el límite diario de IA de la
 * persona): el servidor decide la variante según quién mira a quién —
 * completo para la jefatura, solo hallazgos para quien ve al equipo, y un
 * mensaje motivacional para quien mira los propios sin tener equipo— y
 * nunca envía a la IA el nombre de la persona ni datos de salud.
 */
import { useEffect, useRef, useState } from "react";

import { errorDeNova, novaService } from "../../../api/novaService";
import { Icon } from "../../../components/common/Icon/Icon";
import { AvisoIa, AvisoSinIa } from "../Nova/AvisosNova";
import { Seccion } from "./Componentes";

function Lista({ titulo, elementos }) {
  if (!elementos?.length) return null;
  return (
    <div>
      <h4 className="mz-small mz-strong mb-1">{titulo}</h4>
      <ul className="mb-0">
        {elementos.map((e, i) => (
          <li key={`${i}-${e}`}>{e}</li>
        ))}
      </ul>
    </div>
  );
}

function Resultado({ datos }) {
  if (datos.variante === "motivacional") {
    return (
      <div className="mz-stack">
        {datos.mensajes?.map((m, i) => (
          <p key={`${i}-${m}`} className="mb-0">
            {m}
          </p>
        ))}
      </div>
    );
  }
  return (
    <div className="mz-stack">
      <p className="mz-strong mb-0">{datos.hallazgo_principal}</p>
      <Lista titulo="Riesgos" elementos={datos.riesgos} />
      <Lista titulo="Aspectos positivos" elementos={datos.aspectos_positivos} />
      <Lista titulo="Recomendaciones" elementos={datos.recomendaciones} />
    </div>
  );
}

/**
 * @param {object} props
 * @param {number} props.usuarioId la persona cuyos KPI se analizan
 */
export function PanelNova({ usuarioId }) {
  const [estado, setEstado] = useState({ cargando: false });
  const titulo = useRef(null);

  async function pedir() {
    if (estado.cargando) return;
    setEstado({ cargando: true });
    try {
      setEstado({
        cargando: false,
        datos: await novaService.analisisKpi(usuarioId),
      });
    } catch (err) {
      setEstado({
        cargando: false,
        error: errorDeNova(err, "No se pudo obtener el análisis de Nova.")
          .mensaje,
      });
    }
  }

  const { cargando, datos, error } = estado;

  // Con el resultado, el botón desaparece: el foco va al título de la sección
  // (no cae en <body>) y desde ahí se lee el análisis.
  useEffect(() => {
    if (datos) titulo.current?.focus();
  }, [datos]);

  return (
    <Seccion
      id="gk-nova"
      titulo="Análisis de Nova"
      tituloRef={titulo}
      accion={
        !datos && (
          <button
            type="button"
            className="btn btn-outline-primary btn-sm gk-nova-boton"
            onClick={pedir}
            // Sin `disabled`: el foco no cae en <body> mientras analiza.
            aria-disabled={cargando}
          >
            <Icon name="stars" />{" "}
            {cargando
              ? "Analizando…"
              : error
                ? "Reintentar"
                : "Generar análisis"}
          </button>
        )
      }
    >
      {/* Sin región viva propia: anuncian el `status` y el `alert` de dentro. */}
      <div className="mz-stack">
        {!datos && !cargando && !error && (
          <p className="mz-small mz-faint mb-0">
            Nova explica en lenguaje natural los indicadores de este mes. A la
            IA no se envía el nombre de la persona ni datos de salud.
          </p>
        )}
        {cargando && (
          <p className="mb-0" role="status">
            Nova está analizando los indicadores…
          </p>
        )}
        {error && (
          <p className="mz-alert mz-alert--bad mb-0" role="alert">
            {error}
          </p>
        )}
        {datos && (
          <>
            {datos.con_ia ? (
              <AvisoIa />
            ) : (
              <AvisoSinIa mensaje={datos.mensaje} />
            )}
            <Resultado datos={datos} />
          </>
        )}
      </div>
    </Seccion>
  );
}
