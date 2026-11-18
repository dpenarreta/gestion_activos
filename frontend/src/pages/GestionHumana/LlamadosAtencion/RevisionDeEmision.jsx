/*
 * El último paso antes de emitir (o de confirmar y emitir): emitir notifica a
 * la persona por correo y no se deshace (solo se anula), así que se muestra
 * qué se va a registrar y qué correo saldrá, con los datos reales. El botón
 * final dice lo que hace.
 */
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { formatearMoneda } from "../../../utils/formato";
import { ErrorEnLinea, fecha } from "../comunes";
import { NOTA_POR_CALCULAR } from "./SancionYRazon";
import {
  SANCION,
  TIPOS,
  nombreYApellidos,
  porcentajeANumero,
  montoANumero,
  renderPlantilla,
} from "./llamadosComunes";

export function RevisionDeEmision({
  titulo,
  persona,
  causa,
  nivel,
  sancion: datosSancion,
  razon,
  documentoTitulo = "",
  articulo = "",
  fechaHecho,
  descripcion,
  jefe,
  personaTieneCorreo,
  aviso,
  emitidoPor,
  guardando,
  error,
  onVolver,
  onEmitir,
}) {
  const sancion = nivel?.tipo === SANCION;
  // «12,5» se muestra como 12,50. Con porcentaje, el monto queda por calcular.
  const porcentaje = sancion && datosSancion?.forma === "porcentaje";
  const monto = datosSancion?.monto ?? "";
  const montoFinal = montoANumero(monto) ?? monto;
  const porcentajeFinal = porcentajeANumero(datosSancion?.porcentaje) ?? "";
  const textoSancion = !sancion
    ? ""
    : porcentaje
      ? `${porcentajeFinal.replace(".", ",")} % del sueldo`
      : monto !== ""
        ? `${Number(montoFinal).toFixed(2).replace(".", ",")} USD`
        : "";
  // Sin correo registrado el llamado se emite igual, pero sin correo.
  const sinCorreo = personaTieneCorreo === false;
  const envia = Boolean(nivel?.envia_correo) && !sinCorreo;
  const { nombre, apellidos } = nombreYApellidos(persona);
  const valores = {
    nombre,
    apellidos,
    causa,
    nivel: nivel?.nombre,
    fecha_hecho: fecha(fechaHecho),
    descripcion,
    monto: !sancion
      ? ""
      : porcentaje
        ? textoSancion
        : monto !== ""
          ? formatearMoneda(montoFinal)
          : "",
    sancion: textoSancion,
    porcentaje: porcentaje ? porcentajeFinal.replace(".", ",") : "",
    documento: documentoTitulo,
    articulo,
    razon,
    emitido_por: emitidoPor,
  };
  const asunto = renderPlantilla(nivel?.asunto, valores);
  const cuerpo = renderPlantilla(nivel?.cuerpo, valores);
  // Lo que solo conoce el servidor (la empresa, por ejemplo) se completa al
  // enviar: se avisa en vez de mostrar una llave suelta sin explicación.
  const pendientes = [
    ...new Set([...asunto.desconocidas, ...cuerpo.desconocidas]),
  ];
  const nombrePersona = persona?.full_name ?? "la persona";

  return (
    <ModalDialog
      titulo={titulo}
      subtitulo="Revise antes de continuar: el llamado se registra y, si el nivel lo indica, se envía el correo. Para deshacerlo habría que anularlo."
      onCerrar={onVolver}
      onSubmit={onEmitir}
      textoConfirmar={envia ? "Emitir y enviar correo" : "Emitir sin correo"}
      textoGuardando="Emitiendo…"
      textoCancelar="Volver"
      variante={sancion ? "danger" : "primary"}
      isSaving={guardando}
      anchoMaximo="42rem"
      sinPreguntarAlDescartar
    >
      <div className="mz-stack">
        {error && <ErrorEnLinea mensaje={error} />}
        {aviso && (
          <p className="mz-alert mz-alert--warn mb-0" role="status">
            {aviso}
          </p>
        )}
        {sinCorreo && nivel?.envia_correo && (
          <p className="mz-alert mz-alert--warn mb-0" role="status">
            Esta persona no tiene correo registrado: el llamado se emitirá sin
            correo; notifíquela por otro medio.
          </p>
        )}
        <dl className="d-grid gap-2 mb-0">
          <div>
            <dt className="mz-small mz-faint">Persona</dt>
            <dd className="mb-0">{nombrePersona}</dd>
          </div>
          <div>
            <dt className="mz-small mz-faint">Causa</dt>
            <dd className="mb-0">{causa}</dd>
          </div>
          <div>
            <dt className="mz-small mz-faint">Nivel</dt>
            <dd className="mb-0">
              {nivel?.nombre} ({TIPOS[nivel?.tipo] ?? nivel?.tipo})
            </dd>
          </div>
          <div>
            <dt className="mz-small mz-faint">Fecha del hecho</dt>
            <dd className="mb-0">{fecha(fechaHecho)}</dd>
          </div>
          <div>
            <dt className="mz-small mz-faint">Descripción</dt>
            <dd className="mb-0" style={{ whiteSpace: "pre-wrap" }}>
              {descripcion}
            </dd>
          </div>
          {sancion && (
            <div>
              <dt className="mz-small mz-faint">Sanción</dt>
              <dd className="mb-0">
                <strong>{textoSancion}</strong>
                {porcentaje && (
                  <div className="mz-small mz-faint">{NOTA_POR_CALCULAR}</div>
                )}
              </dd>
            </div>
          )}
          {razon && (
            <div>
              <dt className="mz-small mz-faint">Razón del reglamento</dt>
              <dd className="mb-0">{razon}</dd>
            </div>
          )}
        </dl>

        <p className="mb-0" role="status">
          {envia ? (
            <>
              Se enviará un correo a <strong>{nombrePersona}</strong>
              {nivel.copia_jefe
                ? jefe === null
                  ? " (sin copia: no tiene un jefe registrado)"
                  : ` con copia a ${jefe || "su jefe inmediato"}`
                : ""}
              .
            </>
          ) : sinCorreo && nivel?.envia_correo ? (
            "No se enviará correo; solo queda registrado."
          ) : (
            "Este nivel no envía correo; solo queda registrado."
          )}
        </p>

        {envia && (
          <section
            className="mz-card p-3"
            aria-label="Vista previa del correo con los datos reales"
          >
            <p className="mz-small mz-faint">Vista previa del correo</p>
            <p className="mb-2">
              <strong>Asunto:</strong> {asunto.texto}
            </p>
            <p className="mb-0" style={{ whiteSpace: "pre-wrap" }}>
              {cuerpo.texto}
            </p>
            {pendientes.length > 0 && (
              <p className="mz-small mz-faint mt-2 mb-0">
                Se completará al enviar:{" "}
                {pendientes.map((p) => `{${p}}`).join(", ")}.
              </p>
            )}
          </section>
        )}
      </div>
    </ModalDialog>
  );
}
