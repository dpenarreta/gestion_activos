import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { activosService } from "../../api/servicios";
import { conActaDeEntrega, TEXTO_ABRIENDO_ACTA, TITULO_ACTA_ENTREGA, useActaDeEntrega } from "../../activos/actaEntrega";
import { tomarResultado } from "../../activos/avisoPendiente";
import {
  cambiosDelMovimiento,
  dinero,
  estaOperativo,
  fichaEnLaWeb,
  garantiaDe,
  mantenimientosOrdenados,
  mensajeDeActivos,
  puedeEditarActivos,
  TEXTO_NO_DISPONIBLE,
} from "../../activos/formato";
import { Alerta, Boton, Cargando, Desplegable, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { Refresco } from "../../componentes/Refresco";
import { Icono } from "../../componentes/Icono";
import { useSesion } from "../../sesion/SesionContext";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { fechaCorta, fechaYHora } from "../../utils/fechas";
import { Dato, Pildora, Seccion } from "../soporte/piezas";
import { FormularioAsignar, FormularioCambiarEstado } from "./AccionesDelActivo";
import { FilaDeMantenimiento, rutaDelMantenimiento } from "./Mantenimientos";
import { ActivosEnElNavegador, EstadoDelActivo, useMontado } from "./piezas";

/** La ruta de «Registrar mantenimiento» (CA-14):
 * `/mantenimientos/nuevo?activo=ID`. La usan la ficha y el escáner. */
export function rutaDeRegistrarMantenimiento(activo) {
  return { pathname: "/mantenimientos/nuevo", params: { activo: String(activo.id) } };
}

const TIPOS_EN_PLURAL = { preventivo: "preventivos", correctivo: "correctivos" };

/** La ruta de «Editar» (US-023, CA-4): `/activos/ID/editar`. */
export function rutaDeEditarActivo(activo) {
  return { pathname: "/activos/[id]/editar", params: { id: String(activo.id) } };
}

/** Los movimientos a la vista; el resto, con «Ver todos (N)» (UX H-02). */
export const MOVIMIENTOS_A_LA_VISTA = 5;

/** Un movimiento de la bitácora (CA-7): qué pasó, cuándo, quién y qué
 * cambió. US-028 (CA-7): en una asignación, quien tiene
 * `activos.acta_entrega` ve el acta AEE-LC-01 (`conActa`), como la web. */
function FilaMovimiento({ m, conActa = false, abriendoActa = false, ocupado = false, onActa }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const cambios = cambiosDelMovimiento(m);
  return (
    <View style={estilos.fila} testID={`movimiento-${m.id}`}>
      <Text style={estilos.filaTitulo}>{m.tipo_display || m.tipo}</Text>
      <Text style={estilos.tenue}>
        {[fechaYHora(m.created_at), m.registrado_por_nombre ? `por ${m.registrado_por_nombre}` : null].filter(Boolean).join(" · ")}
      </Text>
      {cambios.map((c) => (
        <Text key={c} style={estilos.dato}>
          {c}
        </Text>
      ))}
      {m.motivo ? <Text style={estilos.dato}>{`Motivo: ${m.motivo}`}</Text> : null}
      {conActa ? (
        <Boton
          testID={`acta-entrega-${m.id}`}
          titulo={abriendoActa ? TEXTO_ABRIENDO_ACTA : TITULO_ACTA_ENTREGA}
          // Mientras se abre, el nombre accesible es el texto visible (QA,
          // 17/11/2026).
          etiqueta={
            abriendoActa
              ? TEXTO_ABRIENDO_ACTA
              : `Acta de recepción de equipo AEE-LC-01 de la entrega a ${m.custodio_nuevo_nombre}`
          }
          pista="Abre el PDF del acta; si todavía no se generó, lleva a la web"
          icono="file-document-outline"
          variante="secundario"
          cargando={abriendoActa}
          deshabilitado={ocupado && !abriendoActa}
          // Sin devolver la promesa: el candado de `useActaDeEntrega` evita
          // el segundo toque.
          onPress={() => {
            onActa?.(m);
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * La ficha de un activo (US-022, CA-7), con `GET activos/{id}/historial/`:
 * los datos, la garantía, los responsables, la bitácora (mantenimientos,
 * los abiertos primero, y movimientos, con fecha y quién) y los costos.
 * Desde ella: «Asignar» (CA-8, con `activos.asignar`), «Cambiar estado»
 * (CA-9, con `activos.dar_baja`), «Registrar mantenimiento» (CA-14, con
 * `mantenimientos.registrar`) y lo que se hace en la web (CA-10). Cada
 * mantenimiento de la bitácora abre su detalle (CA-13), con la empresa del
 * aviso si vino de uno.
 *
 * `empresa`: la de un aviso (B3 de la US-009). Las acciones solo se ofrecen
 * en la empresa activa: los permisos y los catálogos son los de ella.
 */
export function FichaActivo({ id, empresa = null }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const router = useRouter();
  const { usuario, empresaActiva, versionEmpresa } = useSesion();
  const permisos = usuario?.permissions ?? [];
  const [carga, setCarga] = useState({ estado: "cargando", datos: null, error: null, aviso: null });
  const [refrescando, setRefrescando] = useState(false);
  const [ventana, setVentana] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [masDatos, setMasDatos] = useState(false);
  const [todosLosMovimientos, setTodosLosMovimientos] = useState(false);
  const montado = useMontado();
  const consulta = useRef(0);
  const cargaRef = useRef(carga);
  cargaRef.current = carga;
  const acta = useActaDeEntrega({ activoId: id, empresa: empresa ?? empresaActiva?.id });

  const cargar = useCallback(
    async ({ silenciosa = false } = {}) => {
      const numero = ++consulta.current;
      if (!silenciosa) setCarga({ estado: "cargando", datos: null, error: null, aviso: null });
      try {
        const datos = await activosService.historial(id, { empresa: empresa ?? undefined });
        if (!montado.current || numero !== consulta.current) return;
        setCarga({ estado: "listo", datos, error: null, aviso: null });
      } catch (e) {
        if (!montado.current || numero !== consulta.current) return;
        const noEsta = e?.response?.status === 404;
        if (silenciosa && cargaRef.current.estado === "listo" && !noEsta) {
          const aviso = `${mensajeDeActivos(e, "No se pudo actualizar la ficha.")} Se muestra la última información.`;
          setCarga((c) => ({ ...c, aviso }));
        } else {
          setCarga({
            estado: "error",
            datos: null,
            error: noEsta ? TEXTO_NO_DISPONIBLE : mensajeDeActivos(e, "No se pudo abrir la ficha del activo."),
            aviso: null,
          });
        }
      }
    },
    [id, empresa, montado],
  );

  useEffect(() => {
    cargar();
  }, [cargar, versionEmpresa]);

  // Al volver de «Registrar mantenimiento» o de su detalle, la ficha se
  // actualiza en silencio: el equipo pudo pasar a «En reparación» o volver
  // de ella (CA-14, CA-16).
  // Solo al volver a la pantalla: el efecto no depende de `cargar` (un
  // filtro nuevo cambia `cargar` y, en expo-router, volvería a correr el
  // efecto con la pantalla enfocada: dos pedidos por cada cambio).
  const cargarRef = useRef(cargar);
  cargarRef.current = cargar;
  const primeraVez = useRef(true);
  // US-023: lo que dejó el alta (el código de barras, a quién no le llegó
  // el correo) o la edición («Ficha actualizada»), una sola vez; al volver
  // de «Editar», además, la ficha se recarga.
  useFocusEffect(
    useCallback(() => {
      const previo = tomarResultado(`activo-${id}`);
      if (previo) setResultado({ ...previo, clave: Date.now() });
      if (primeraVez.current) {
        primeraVez.current = false;
        return;
      }
      if (cargaRef.current.estado === "listo") cargarRef.current({ silenciosa: true });
    }, [id]),
  );

  async function refrescar() {
    setRefrescando(true);
    await cargar({ silenciosa: cargaRef.current.estado === "listo" });
    if (montado.current) setRefrescando(false);
  }

  // CA-8: al guardar, la ficha se recarga y se anuncia el resultado (la
  // `Alerta` de tipo «bien» se anuncia sola).
  function alGuardar(_actualizado, mensaje) {
    setVentana(null);
    setResultado({ texto: mensaje, clave: Date.now() });
    cargar({ silenciosa: true });
  }

  if (carga.estado === "cargando") return <Cargando texto="Cargando la ficha…" />;
  if (carga.estado === "error") {
    return (
      <View style={estilos.centro}>
        <ErrorConReintento texto={carga.error} onReintentar={() => cargar()} />
      </View>
    );
  }

  const { activo = {}, movimientos = [], mantenimientos = [], costos = {} } = carga.datos ?? {};
  const operativo = estaOperativo(activo);
  const enLaActiva = !empresa || String(empresa) === String(empresaActiva?.id ?? "");
  const puedeAsignar = enLaActiva && operativo && permisos.includes("activos.asignar");
  const puedeCambiarEstado = enLaActiva && permisos.includes("activos.dar_baja") && activo.estado !== "dado_de_baja";
  const puedeRegistrar = enLaActiva && operativo && permisos.includes("mantenimientos.registrar");
  // US-023 (CA-1): «Editar» con `activos.editar` y solo en la empresa activa
  // (no desde un aviso de otra), como asignar.
  const puedeEditar = enLaActiva && puedeEditarActivos(permisos);
  const garantia = garantiaDe(activo);
  const bitacora = mantenimientosOrdenados(mantenimientos);
  const sede = [activo.sede_nombre, activo.ciudad !== activo.sede_nombre ? activo.ciudad : null].filter(Boolean).join(", ");

  return (
    <ScrollView
      testID="ficha-activo"
      style={estilos.pantalla}
      contentContainerStyle={estilos.contenido}
      refreshControl={<Refresco refreshing={refrescando} onRefresh={refrescar} />}
    >
      {carga.aviso ? <Alerta tipo="aviso" texto={carga.aviso} /> : null}
      {resultado ? <Alerta tipo="bien" texto={resultado.texto} clave={resultado.clave} testID="resultado-accion" /> : null}
      {resultado?.aviso ? <Alerta tipo="aviso" texto={resultado.aviso} testID="aviso-sin-correo" /> : null}

      <View style={estilos.cabecera}>
        <Text style={estilos.codigo} testID="codigo-del-activo">
          {activo.codigo_barras}
        </Text>
        <Text style={estilos.titulo} accessibilityRole="header">
          {activo.nombre}
        </Text>
        <EstadoDelActivo activo={activo} testID="estado-del-activo" />
        <Text style={estilos.tenue}>{[activo.tipo_nombre, activo.marca, activo.modelo].filter(Boolean).join(" · ")}</Text>
      </View>

      {/* UX H-02: lo primero que se pregunta en el sitio es de quién es y si
          tiene garantía; después, qué hacer con él. */}
      <Seccion titulo="¿De quién es?" testID="responsables">
        <Text style={estilos.subtituloChico}>{activo.compartido ? "Responsables (equipo compartido)" : "Responsable"}</Text>
        {(activo.responsables ?? []).length === 0 ? (
          <Text style={estilos.tenue}>Sin asignar: el equipo está en bodega.</Text>
        ) : (
          activo.responsables.map((p) => (
            <View
              key={p.id}
              style={estilos.persona}
              accessible
              accessibilityLabel={`${p.nombre_completo}${p.codigo_empleado ? `, código ${p.codigo_empleado}` : ""}${
                p.recibe_avisos === false ? ". No recibe los avisos por correo" : ""
              }`}
            >
              <Icono nombre="account-outline" size={20} color={colores.tintaSuave} />
              <View style={estilos.personaTextos}>
                <Text style={estilos.dato}>{p.nombre_completo}</Text>
                {p.codigo_empleado ? <Text style={estilos.tenue}>{`Código ${p.codigo_empleado}`}</Text> : null}
                {p.recibe_avisos === false ? <Text style={estilos.tenue}>No recibe los avisos por correo</Text> : null}
              </View>
            </View>
          ))
        )}
        <Dato nombre="Área" valor={activo.departamento_nombre || "Sin área"} />
        <Dato nombre="Sede" valor={sede || "Sin sede"} />
      </Seccion>

      <Seccion titulo="Garantía" testID="garantia">
        <Pildora texto={garantia.texto} tono={garantia} />
        <Dato nombre="Fin de la garantía" valor={activo.fecha_fin_garantia ? fechaCorta(activo.fecha_fin_garantia) : null} />
        {garantia.detalle ? <Text style={estilos.tenue}>{garantia.detalle}</Text> : null}
      </Seccion>

      {puedeAsignar || puedeCambiarEstado || puedeRegistrar || puedeEditar ? (
        <View style={estilos.acciones}>
          {puedeAsignar ? (
            <Boton testID="asignar" titulo="Asignar" icono="account-switch-outline" onPress={() => setVentana("asignar")} />
          ) : null}
          {puedeCambiarEstado ? (
            <Boton
              testID="cambiar-estado"
              titulo="Cambiar estado"
              icono="swap-vertical"
              variante="secundario"
              onPress={() => setVentana("estado")}
            />
          ) : null}
          {puedeRegistrar ? (
            <Boton
              testID="registrar-mantenimiento"
              titulo="Registrar mantenimiento"
              icono="wrench-outline"
              variante="secundario"
              onPress={() => router.push(rutaDeRegistrarMantenimiento(activo))}
            />
          ) : null}
          {puedeEditar ? (
            <Boton
              testID="editar-activo"
              titulo="Editar"
              etiqueta="Editar la ficha técnica"
              icono="pencil-outline"
              variante="secundario"
              onPress={() => router.push(rutaDeEditarActivo(activo))}
            />
          ) : null}
        </View>
      ) : null}
      {!enLaActiva ? (
        <Alerta
          tipo="info"
          texto="Este activo es de otra empresa. Para editarlo, asignarlo o cambiar su estado, cámbiese a ella en «Cuenta»."
        />
      ) : null}
      {!operativo ? (
        <Alerta tipo="info" texto="Este activo está fuera de inventario: no se asigna ni se le registran mantenimientos." />
      ) : null}

      <Seccion titulo="Datos" testID="datos-del-activo">
        <Dato nombre="Número de serie" valor={activo.numero_serie} />
        <Dato nombre="Área" valor={activo.departamento_nombre} />
        <Dato nombre="Sede" valor={sede || "Sin sede"} />
        <Desplegable
          titulo="Más datos del equipo"
          abierto={masDatos}
          onCambiar={setMasDatos}
          testID="mas-datos"
        >
          <Dato nombre="Criticidad" valor={activo.criticidad_display} />
          <Dato nombre="Uso" valor={activo.uso_display} />
          <Dato nombre="Propiedad" valor={[activo.propiedad_display, activo.concesionario_nombre].filter(Boolean).join(": ")} />
          <Dato nombre="Condición al adquirirlo" valor={activo.condicion_display || "No consta"} />
          <Dato nombre="Fecha de adquisición" valor={activo.fecha_adquisicion ? fechaCorta(activo.fecha_adquisicion) : null} />
          <Dato nombre="Fecha de ingreso" valor={activo.fecha_ingreso ? fechaCorta(activo.fecha_ingreso) : null} />
          <Dato nombre="Costo de adquisición" valor={activo.costo_adquisicion ? dinero(activo.costo_adquisicion) : null} />
          <Dato nombre="Proveedor" valor={activo.proveedor_nombre} />
          <Dato nombre="Solicitado por" valor={activo.solicitado_por_nombre} />
          <Dato nombre="Observaciones" valor={activo.observaciones} />
          {activo.fecha_baja ? <Dato nombre="Fecha de salida del inventario" valor={fechaCorta(activo.fecha_baja)} /> : null}
          <Dato nombre="Motivo de la salida" valor={activo.motivo_baja} />
        </Desplegable>
      </Seccion>

      <Seccion titulo="Mantenimientos" testID="bitacora-mantenimientos">
        {bitacora.length === 0 ? (
          <Vacio icono="tools" texto="Sin mantenimientos registrados." />
        ) : (
          bitacora.map((m) => (
            <FilaDeMantenimiento
              key={m.id}
              m={m}
              conActivo={false}
              onAbrir={(x) => router.push(rutaDelMantenimiento(x, empresa))}
            />
          ))
        )}
      </Seccion>

      <Seccion titulo="Movimientos" testID="bitacora-movimientos">
        {acta.aviso ? (
          <Alerta tipo={acta.aviso.tipo} texto={acta.aviso.texto} clave={acta.aviso.clave} testID="aviso-acta-entrega" />
        ) : null}
        {movimientos.length === 0 ? (
          <Vacio icono="history" texto="Sin movimientos registrados." />
        ) : (
          (todosLosMovimientos ? movimientos : movimientos.slice(0, MOVIMIENTOS_A_LA_VISTA)).map((m) => (
            <FilaMovimiento
              key={m.id}
              m={m}
              conActa={enLaActiva && conActaDeEntrega(m, permisos)}
              abriendoActa={acta.abriendo === m.id}
              ocupado={acta.abriendo !== null}
              onActa={acta.abrir}
            />
          ))
        )}
        {movimientos.length > MOVIMIENTOS_A_LA_VISTA ? (
          <Boton
            testID="ver-todos-los-movimientos"
            titulo={todosLosMovimientos ? "Ver solo los últimos" : `Ver todos (${movimientos.length})`}
            icono={todosLosMovimientos ? "chevron-up" : "chevron-down"}
            variante="secundario"
            expandido={todosLosMovimientos}
            onPress={() => setTodosLosMovimientos((v) => !v)}
          />
        ) : null}
      </Seccion>

      <Seccion titulo="Costos" testID="costos">
        <Dato nombre="Mano de obra" valor={dinero(costos.costo_mano_obra ?? 0)} />
        <Dato nombre="Repuestos" valor={dinero(costos.costo_repuestos ?? 0)} />
        <Dato nombre="Total invertido" valor={dinero(costos.costo_total ?? 0)} />
        {Object.entries(costos.mantenimientos_por_tipo ?? {}).map(([tipo, total]) => (
          <Dato key={tipo} nombre={`Mantenimientos ${TIPOS_EN_PLURAL[tipo] ?? tipo}`} valor={String(total)} />
        ))}
      </Seccion>

      <ActivosEnElNavegador
        accesos={fichaEnLaWeb(activo, permisos)}
        empresa={empresa ?? empresaActiva?.id}
        titulo="En el navegador"
        testID="ficha-en-el-navegador"
      />

      {ventana === "asignar" ? (
        <FormularioAsignar activo={activo} onCerrar={() => setVentana(null)} onGuardado={alGuardar} />
      ) : null}
      {ventana === "estado" ? (
        <FormularioCambiarEstado activo={activo} onCerrar={() => setVentana(null)} onGuardado={alGuardar} />
      ) : null}
    </ScrollView>
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, paddingBottom: 40, gap: 16 },
  centro: { padding: 16 },
  cabecera: { gap: 6 },
  codigo: { fontSize: 14, fontWeight: "600", color: colores.tintaSuave },
  titulo: { fontSize: 20, fontWeight: "700", color: colores.titulo },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  dato: { fontSize: 15, color: colores.tinta },
  acciones: { gap: 8 },
  fila: {
    gap: 4,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  filaCabecera: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  filaTitulo: { flexShrink: 1, fontSize: 16, fontWeight: "700", color: colores.titulo },
  persona: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  personaTextos: { flex: 1, gap: 2 },
  subtituloChico: { fontSize: 15, fontWeight: "600", color: colores.tinta },
});
