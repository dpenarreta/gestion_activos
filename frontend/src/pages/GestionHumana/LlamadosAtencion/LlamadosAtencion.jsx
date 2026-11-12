/*
 * Gestión Humana › Llamados de atención (US-013). Dos pestañas: «Llamados»
 * (emitir, solicitar, confirmar, rechazar, anular y consultar) y «Causas»
 * (solo con `llamados.configurar`: causas, niveles y plantillas de correo).
 * Los permisos solo deciden qué se ofrece: el servidor autoriza cada petición
 * y limita al jefe a su equipo y a lo que él solicitó.
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { llamadosService } from "../../../api/llamadosService";
import {
  PanelDePestana,
  Pestanas,
} from "../../../components/common/Pestanas/Pestanas";
import { useAuth } from "../../../hooks/useAuth";
import {
  LLAMADOS_CONFIGURAR,
  LLAMADOS_EMITIR,
  LLAMADOS_SOLICITAR,
  LLAMADOS_VER,
} from "../../../modulos/permisosGestionHumana";
import { mensajeDeError } from "../../../utils/errores";
import { Encabezado } from "../Tareas/ContextoTareas";
import "../GestionHumana.css";
import { CausasLlamados } from "./CausasLlamados";
import { ListaLlamados } from "./ListaLlamados";

export function LlamadosAtencion() {
  const { user } = useAuth();
  const permisos = user?.permissions ?? [];
  const puedeEmitir = permisos.includes(LLAMADOS_EMITIR);
  const puedeConfigurar = permisos.includes(LLAMADOS_CONFIGURAR);
  const puedeSolicitar = permisos.includes(LLAMADOS_SOLICITAR);
  const puedeVerTodos = puedeEmitir || permisos.includes(LLAMADOS_VER);
  const [parametros, setParametros] = useSearchParams();
  const veLlamados = puedeVerTodos || puedeSolicitar;
  // Con solo `configurar` la pantalla abre en Causas: el servidor no le
  // entrega la lista de llamados.
  const pedida = parametros.get("vista");
  const vista =
    puedeConfigurar && (pedida === "causas" || !veLlamados)
      ? "causas"
      : "llamados";

  const [causas, setCausas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [variables, setVariables] = useState([]);
  const [errorVariables, setErrorVariables] = useState(null);

  const cargarCausas = useCallback(() => {
    setCargando(true);
    setError(null);
    return llamadosService
      .causas()
      .then(setCausas)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar las causas.")),
      )
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    cargarCausas();
  }, [cargarCausas]);

  // Las variables solo las usa el editor de plantillas.
  useEffect(() => {
    if (!puedeConfigurar) return undefined;
    let vigente = true;
    llamadosService
      .variables()
      .then((lista) => vigente && setVariables(lista))
      .catch(
        (err) =>
          vigente &&
          setErrorVariables(
            mensajeDeError(err, "No se pudieron cargar las variables."),
          ),
      );
    return () => {
      vigente = false;
    };
  }, [puedeConfigurar]);

  function cambiarVista(id) {
    setParametros({ vista: id });
  }

  const opciones = [
    ...(veLlamados
      ? [{ id: "llamados", etiqueta: "Llamados", icono: "list-ul" }]
      : []),
    ...(puedeConfigurar
      ? [{ id: "causas", etiqueta: "Causas", icono: "gear" }]
      : []),
  ];

  return (
    <div className="gh-page">
      <Encabezado
        titulo="Llamados de atención"
        descripcion={
          puedeEmitir
            ? "Registre y notifique los llamados de atención con niveles progresivos."
            : "Solicite llamados de atención para su equipo y consulte su estado."
        }
      />
      <Pestanas
        etiqueta="Llamados de atención"
        idBase="la"
        valor={vista}
        onCambio={cambiarVista}
        opciones={opciones}
      />
      <PanelDePestana idBase="la" valor={vista} className="mt-3">
        {vista === "llamados" ? (
          <ListaLlamados
            causas={causas}
            cargandoCausas={cargando}
            errorCausas={error}
            puedeConfigurar={puedeConfigurar}
            puedeEmitir={puedeEmitir}
            puedeVerTodos={puedeVerTodos}
            puedeSolicitar={puedeSolicitar}
          />
        ) : (
          <CausasLlamados
            causas={causas}
            cargando={cargando}
            error={error}
            variables={variables}
            errorVariables={errorVariables}
            onReintentar={cargarCausas}
            onGuardada={cargarCausas}
          />
        )}
      </PanelDePestana>
    </div>
  );
}
