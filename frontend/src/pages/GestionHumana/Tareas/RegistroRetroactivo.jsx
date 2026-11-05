/*
 * Registro retroactivo de horas (`RetroactiveActivityModal` de Nexo). Solo en
 * tareas de Seguimiento y solo para los últimos días laborables de la
 * ventana que fija el Administrador (sin hoy), más el sábado y el domingo
 * inmediatos si hoy es lunes o martes. La descripción es obligatoria y el
 * servidor avisa a los roles configurados. El servidor vuelve a validar la
 * fecha, el motivo y el cruce de horarios.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { errorDeTareas, tareasService } from "../../../api/tareasService";
import {
  Campo,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { ErrorEnLinea } from "../comunes";
import { TAREAS_ADMINISTRAR } from "../../../modulos/permisosGestionHumana";
import {
  CamposDeHoras,
  REGISTRO_VACIO,
  SinMotivos,
  cruceCon,
  cuerpoDelRegistro,
  useAgendaDelDia,
  useFormatoDeActividad,
  validarRegistro,
} from "./CamposDeHoras";
import { useMotivos, useTareas } from "./ContextoTareas";
import {
  diaDeLaSemana,
  fechaCorta,
  fechasRetroactivas,
  hoy,
  motivosElegibles,
} from "./tareasComunes";

/** La ventana por defecto del servidor mientras llegan los ajustes. */
const VENTANA_POR_DEFECTO = 2;

export function RegistroRetroactivo({ tarea, onCerrar, onGuardado }) {
  const { roles, can } = useTareas();
  // El subtítulo dice la ventana real: se muestra cuando llegan los ajustes.
  const [ajustesListos, setAjustesListos] = useState(false);
  const { motivos, errorMotivos, recargarMotivos } = useMotivos();
  const [ventana, setVentana] = useState(VENTANA_POR_DEFECTO);
  const dias = useMemo(() => fechasRetroactivas(hoy(), ventana), [ventana]);
  const [fecha, setFecha] = useState("");
  const [formato, setFormato] = useFormatoDeActividad();
  const [valores, setValores] = useState(REGISTRO_VACIO);
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  const panel = useRef(null);
  const dia = fecha || dias[0] || "";
  const { agenda, error: agendaError } = useAgendaDelDia(formato, dia);

  useEffect(() => {
    let vigente = true;
    tareasService
      .ajustes()
      .then((a) => {
        if (!vigente) return;
        if (a?.retroactive_window_business_days)
          setVentana(a.retroactive_window_business_days);
        setAjustesListos(true);
      })
      // Sin ajustes se usa la ventana por defecto: el servidor valida igual.
      .catch(() => vigente && setAjustesListos(true));
    return () => {
      vigente = false;
    };
  }, []);

  const elegibles = useMemo(
    () => (motivos === null ? null : motivosElegibles(motivos, roles)),
    [motivos, roles],
  );
  const cruce = formato === "horario" ? cruceCon(agenda, valores) : null;
  const sinMotivos = elegibles?.length === 0;

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const e = validarRegistro(formato, valores, { cruce, descripcion: true });
    if (!dia) e.activity_date = "Elija la fecha de la actividad.";
    setErrores(e);
    setError(null);
    if (Object.keys(e).length) {
      enfocarPrimerError(panel.current);
      return;
    }
    enCurso.current = true;
    setGuardando(true);
    try {
      await tareasService.registrarRetroactiva(tarea.id, {
        ...cuerpoDelRegistro(formato, valores),
        activity_date: dia,
      });
      onGuardado(
        `Horas retroactivas del ${fechaCorta(dia)} registradas en «${tarea.title}».`,
      );
    } catch (err) {
      const fallo = errorDeTareas(
        err,
        "No se pudo registrar la actividad retroactiva.",
      );
      setErrores(fallo.campos);
      setError(fallo.mensaje);
      enfocarPrimerError(panel.current);
      setGuardando(false);
      enCurso.current = false;
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo="Registro retroactivo de horas"
      subtitulo={
        ajustesListos
          ? `Tarea «${tarea.title}». Solo los últimos ${ventana} días laborables (sin contar hoy) y, si hoy es lunes o martes, el fin de semana anterior.`
          : `Tarea «${tarea.title}».`
      }
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar="Registrar horas retroactivas"
      isSaving={guardando}
      puedeConfirmar={dias.length > 0 && !sinMotivos}
    >
      <div ref={panel}>
        {sinMotivos ? (
          <SinMotivos administra={can(TAREAS_ADMINISTRAR)} />
        ) : dias.length === 0 ? (
          <div className="mz-alert mz-alert--warn" role="alert">
            <span>No hay días disponibles para un registro retroactivo.</span>
          </div>
        ) : (
          <Campo
            id="gt-retro-fecha"
            etiqueta="Fecha de la actividad"
            obligatorio
            error={errores.activity_date}
            className="mb-3"
          >
            <select
              className="form-select"
              value={dia}
              onChange={(e) => setFecha(e.target.value)}
            >
              {dias.map((d) => (
                <option key={d} value={d}>
                  {diaDeLaSemana(d)} {fechaCorta(d)}
                </option>
              ))}
            </select>
          </Campo>
        )}
        {!sinMotivos && (
          <CamposDeHoras
            idBase="gt-retro"
            formato={formato}
            onFormato={setFormato}
            valores={valores}
            onCambio={setValores}
            elegibles={elegibles}
            errorMotivos={errorMotivos}
            onReintentarMotivos={recargarMotivos}
            errores={errores}
            agendaError={agendaError}
            cruce={cruce}
            descripcionObligatoria
          />
        )}
        <ErrorEnLinea mensaje={error} className="mt-3" />
      </div>
    </ModalDialog>
  );
}
