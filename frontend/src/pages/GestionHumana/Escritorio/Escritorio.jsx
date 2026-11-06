/*
 * El Escritorio digital de Gestión Humana (`DeskBoard` de Nexo): «Hoy», las
 * notas tipo post-it, los recordatorios personales y el buscador. «Nueva
 * nota» y «Nuevo recordatorio» están siempre a mano, en el encabezado (en
 * Nexo hacía falta cambiar de pestaña primero).
 *
 * La sección, la pestaña de notas y los filtros viven en la URL: al recargar
 * (o al llegar desde un aviso de la campana) la pantalla queda como se dejó.
 * El calendario de Nexo no se porta (decisión del usuario).
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Icon } from "../../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../../components/common/Pestanas/Pestanas";
import { Aviso } from "../comunes";
import { Encabezado } from "../Tareas/ContextoTareas";
import { Buscar, FILTROS_DE_BUSQUEDA } from "./Buscar";
import { ConAccesoEscritorio, useEscritorio } from "./ContextoEscritorio";
import { nombreDe } from "./escritorioComunes";
import { FormularioNota } from "./FormularioNota";
import { FormularioRecordatorio } from "./FormularioRecordatorio";
import { Hoy } from "./Hoy";
import { Notas, VISTAS_DE_NOTAS } from "./Notas";
import { Recordatorios } from "./Recordatorios";

const TITULO = "Escritorio";
const SECCIONES = ["hoy", "notas", "recordatorios", "buscar"];

export function Escritorio() {
  return (
    <ConAccesoEscritorio titulo={TITULO}>
      <Tablero />
    </ConAccesoEscritorio>
  );
}

function Tablero() {
  const { sinLeer } = useEscritorio();
  const [parametros, setParametros] = useSearchParams();
  const pedida = parametros.get("seccion");
  const seccion = SECCIONES.includes(pedida) ? pedida : "hoy";
  const vista = VISTAS_DE_NOTAS.includes(parametros.get("vista"))
    ? parametros.get("vista")
    : "desk";
  const estado = ["PENDIENTE", "COMPLETADO"].includes(parametros.get("estado"))
    ? parametros.get("estado")
    : "";
  const archivados = parametros.get("archivados") === "1";
  const filtros = Object.fromEntries(
    FILTROS_DE_BUSQUEDA.map((c) => [c, parametros.get(c) ?? ""]),
  );
  const [aviso, setAviso] = useState(null);
  const [creando, setCreando] = useState(null);
  // Sube al crear algo: las secciones abiertas vuelven a pedir su lista.
  const [version, setVersion] = useState(0);

  function fijar(cambios) {
    setParametros(
      (actuales) => {
        const nuevos = new URLSearchParams(actuales);
        for (const [clave, valor] of Object.entries(cambios)) {
          if (valor) nuevos.set(clave, valor);
          else nuevos.delete(clave);
        }
        return nuevos;
      },
      { replace: true },
    );
  }

  /** Cambiar de sección deja atrás los filtros de la otra. */
  function irA(nueva) {
    setParametros(nueva === "hoy" ? {} : { seccion: nueva }, {
      replace: true,
    });
  }

  return (
    <div className="gh-page">
      <Encabezado
        titulo={TITULO}
        descripcion="Sus notas, sus recordatorios y lo que importa hoy. Nadie más ve su Escritorio."
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setCreando("nota")}
        >
          <Icon name="sticky" /> Nueva nota
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => setCreando("recordatorio")}
        >
          <Icon name="alarm" /> Nuevo recordatorio
        </button>
      </Encabezado>

      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      <Pestanas
        etiqueta="Secciones del Escritorio"
        idBase="ed-secciones"
        valor={seccion}
        onCambio={irA}
        opciones={[
          { id: "hoy", etiqueta: "Hoy", icono: "sun" },
          {
            id: "notas",
            etiqueta: "Notas",
            icono: "sticky",
            cuenta: sinLeer,
            unidad: "sin leer",
          },
          { id: "recordatorios", etiqueta: "Recordatorios", icono: "alarm" },
          { id: "buscar", etiqueta: "Buscar", icono: "search" },
        ]}
      />
      <PanelDePestana idBase="ed-secciones" valor={seccion} className="gh-page">
        {seccion === "hoy" && <Hoy version={version} onIrA={irA} />}
        {seccion === "notas" && (
          <Notas
            vista={vista}
            onVista={(v) => fijar({ vista: v === "desk" ? "" : v })}
            version={version}
            onAviso={setAviso}
            onNuevaNota={() => setCreando("nota")}
          />
        )}
        {seccion === "recordatorios" && (
          <Recordatorios
            estado={estado}
            archivados={archivados}
            onFiltro={(clave, valor) => fijar({ [clave]: valor })}
            version={version}
            onAviso={setAviso}
            onNuevo={() => setCreando("recordatorio")}
          />
        )}
        {seccion === "buscar" && (
          <Buscar filtros={filtros} onBuscar={(nuevos) => fijar(nuevos)} />
        )}
      </PanelDePestana>

      {creando === "nota" && (
        <FormularioNota
          onCerrar={() => setCreando(null)}
          onCreada={(nota) => {
            setCreando(null);
            setVersion((v) => v + 1);
            setAviso({
              texto: `Nota dejada a ${nombreDe(nota.recipient)}. La verá en su Escritorio.`,
              accion:
                seccion === "notas" && vista === "sent"
                  ? undefined
                  : {
                      texto: "Ver enviadas",
                      onClick: () => {
                        setAviso(null);
                        setParametros(
                          { seccion: "notas", vista: "sent" },
                          { replace: true },
                        );
                      },
                    },
            });
          }}
        />
      )}
      {creando === "recordatorio" && (
        <FormularioRecordatorio
          onCerrar={() => setCreando(null)}
          onGuardado={(r) => {
            setCreando(null);
            setVersion((v) => v + 1);
            setAviso({ texto: `Recordatorio «${r.title}» creado.` });
          }}
        />
      )}
    </div>
  );
}
