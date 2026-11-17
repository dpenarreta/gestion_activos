import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { inicioService } from "../api/servicios";
import {
  Alerta,
  Cargando,
  Desplegable,
  ErrorConReintento,
} from "../componentes/comunes";
import { Icono } from "../componentes/Icono";
import { useSesion } from "../sesion/SesionContext";
import { useColores, useEstilos } from "../tema/apariencia";
import { crearEstilos } from "../tema/tipografia";
import { AbrirEnLaWeb } from "./permisos/piezas";

/**
 * «Mi perfil» en la app (16/11/2026, decisión del usuario): SOLO LECTURA de
 * «Mis datos», «Mi cargo» y «Mi línea de supervisión», con lo mismo que da
 * `GET /organizacion/mis-datos/` a la web (`MisDatosPage.jsx`, `MiCargo.jsx`,
 * `MiSupervision.jsx`). Para cambiar algo se abre la web: el formulario lleva
 * el consentimiento LOPDP del teléfono y sus reglas, que no se duplican aquí.
 */

const NOMBRES_DE_LO_QUE_FALTA = {
  nombre: "nombre y apellido",
  nombres: "nombres",
  apellidos: "apellidos",
  telefono: "teléfono",
  telefono_corporativo: "teléfono corporativo",
  tiene_telefono_corporativo: "si tiene teléfono corporativo",
  // Aviso de contrato del 16/11/2026 (2ed5676): «¿Tiene línea fija?».
  linea_fija: "si tiene línea fija",
  area: "área",
  agencia: "agencia",
  cargo: "cargo",
};

/** «área, agencia y cargo». */
export function queFalta(faltan = []) {
  const nombres = faltan.map(
    (f) => NOMBRES_DE_LO_QUE_FALTA[f] ?? f.replaceAll("_", " "),
  );
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

/**
 * El teléfono que se muestra, con la regla de la web (10/11/2026): si tiene
 * teléfono corporativo, solo ese; si no, el personal, que es opcional.
 */
export function telefonoAMostrar(datos) {
  if (!datos) return null;
  if (datos.tiene_telefono_corporativo === true) {
    return {
      etiqueta: "Teléfono corporativo",
      valor: datos.telefono_corporativo || "",
    };
  }
  if (datos.tiene_telefono_corporativo === false) {
    return { etiqueta: "Teléfono personal", valor: datos.telefono || "" };
  }
  return {
    etiqueta: "Teléfono",
    valor: datos.telefono_corporativo || datos.telefono || "",
  };
}

/**
 * «¿Tiene línea fija?» y su extensión, como «Mis datos» de la web (US-028,
 * CA-1; commit 2ed5676 del 16/11/2026): la respuesta es «Sí» o «No» (sin
 * responder, «Sin registrar») y la extensión solo se muestra con «Sí», igual
 * que el campo de la web, que solo aparece con esa respuesta.
 */
export function lineaFijaAMostrar(datos) {
  const tiene = datos?.tiene_linea_fija;
  return {
    respuesta: tiene === true ? "Sí" : tiene === false ? "No" : "",
    extension: tiene === true ? String(datos?.linea_fija_extension ?? "").trim() : null,
  };
}

/** Un dato: su nombre arriba y el valor debajo; sin valor, «Sin registrar».
 * `nota`: una aclaración debajo, como el texto de ayuda de la web. */
function Dato({ etiqueta, valor, nota, testID }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const vacio = !String(valor ?? "").trim();
  return (
    <View
      style={estilos.dato}
      accessible
      accessibilityLabel={`${etiqueta}: ${vacio ? "sin registrar" : valor}${nota ? `. ${nota}` : ""}`}
      testID={testID}
    >
      <Text style={estilos.datoEtiqueta}>{etiqueta}</Text>
      <Text style={[estilos.datoValor, vacio && estilos.datoVacio]}>
        {vacio ? "Sin registrar" : valor}
      </Text>
      {nota ? <Text style={estilos.datoNota}>{nota}</Text> : null}
    </View>
  );
}

/** Una lista numerada del perfil del cargo (funciones, competencias, KPIs). */
function Lista({ items }) {
  const estilos = useEstilos(fabricaDeEstilos);
  if (!items?.length)
    return <Text style={estilos.tenue}>Todavía no se ha definido.</Text>;
  return (
    <View style={estilos.lista}>
      {items.map((item, i) => (
        <View key={`${i}-${item}`} style={estilos.itemLista}>
          <Text style={estilos.numeroLista}>{`${i + 1}.`}</Text>
          <Text style={estilos.textoLista}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function Tarjeta({ icono, titulo, descripcion, children, testID }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  return (
    <View style={estilos.tarjeta} testID={testID}>
      <View style={estilos.tarjetaCabecera}>
        <Icono nombre={icono} size={22} color={colores.primario} />
        <Text style={estilos.tarjetaTitulo} accessibilityRole="header">
          {titulo}
        </Text>
      </View>
      {descripcion ? <Text style={estilos.tenue}>{descripcion}</Text> : null}
      {children}
    </View>
  );
}

function MiCargo({ perfil }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const [abierto, setAbierto] = useState(null);
  if (!perfil) return null;
  const vacio =
    !perfil.objetivo &&
    !perfil.funciones?.length &&
    !perfil.competencias?.length &&
    !perfil.kpis?.length;
  const secciones = [
    { id: "funciones", titulo: "Funciones", items: perfil.funciones },
    { id: "competencias", titulo: "Competencias", items: perfil.competencias },
    { id: "kpis", titulo: "KPIs y métricas de medición", items: perfil.kpis },
  ];
  return (
    <Tarjeta
      icono="briefcase-outline"
      titulo={`Mi cargo: ${perfil.cargo?.nombre ?? ""}`}
      descripcion="Lo que se espera de su cargo y cómo se mide."
      testID="mi-cargo"
    >
      {vacio ? (
        <Text style={estilos.tenue}>
          El perfil de este cargo todavía no se ha cargado. Lo publica Talento
          Humano o la administración del sistema.
        </Text>
      ) : (
        <>
          <Text style={estilos.subtitulo}>Objetivo del cargo</Text>
          <Text style={perfil.objetivo ? estilos.texto : estilos.tenue}>
            {perfil.objetivo || "Todavía no se ha definido."}
          </Text>
          {/* Desplegables: las listas pueden ser largas y la pantalla es
              también la de la cuenta. */}
          {secciones.map((s) => (
            <Desplegable
              key={s.id}
              testID={`mi-cargo-${s.id}`}
              titulo={`${s.titulo} (${s.items?.length ?? 0})`}
              abierto={abierto === s.id}
              onCambiar={(v) => setAbierto(v ? s.id : null)}
            >
              <Lista items={s.items} />
            </Desplegable>
          ))}
        </>
      )}
    </Tarjeta>
  );
}

/** Las personas de un cargo, con «sin cuenta» en texto. */
function Personas({ personas = [], vacantes = 0 }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  if (!personas.length && !vacantes) return null;
  return (
    <View style={estilos.personas}>
      {personas.map((p) => (
        <View key={p.id} style={estilos.persona}>
          <Icono
            nombre={p.sin_cuenta ? "account-off-outline" : "account-outline"}
            size={18}
            color={colores.tintaSuave}
          />
          <Text style={estilos.texto}>
            {p.nombre}
            {p.sin_cuenta ? (
              <Text style={estilos.tenue}> (sin cuenta)</Text>
            ) : null}
          </Text>
        </View>
      ))}
      {vacantes > 0 ? (
        <Text style={estilos.tenue}>
          {vacantes === 1 ? "1 plaza vacante" : `${vacantes} plazas vacantes`}
        </Text>
      ) : null}
    </View>
  );
}

function Cargo({ cargo, nivel }) {
  const estilos = useEstilos(fabricaDeEstilos);
  return (
    <View style={estilos.cargo}>
      <Text style={estilos.cargoNombre}>{cargo.nombre}</Text>
      {cargo.unidad ? <Text style={estilos.tenue}>{cargo.unidad}</Text> : null}
      <Personas
        personas={cargo.personas}
        vacantes={nivel === "abajo" ? cargo.vacantes : 0}
      />
      {nivel === "arriba" && !cargo.personas?.length ? (
        <Text style={estilos.tenue}>Cargo vacante</Text>
      ) : null}
    </View>
  );
}

function MiSupervision({ linea, cargo }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  if (!linea) return null;
  return (
    <Tarjeta
      icono="sitemap-outline"
      titulo="Mi línea de supervisión"
      descripcion="Según el organigrama: a quién reporta y a quiénes supervisa directamente."
      testID="mi-supervision"
    >
      <View style={estilos.grupo}>
        <View style={estilos.grupoCabecera}>
          <Icono
            nombre="arrow-up-circle-outline"
            size={20}
            color={colores.tintaSuave}
          />
          <Text style={estilos.subtitulo}>Reporta a</Text>
        </View>
        {linea.jefes?.length ? (
          linea.jefes.map((j) => <Cargo key={j.id} cargo={j} nivel="arriba" />)
        ) : (
          <Text style={estilos.tenue}>
            Su cargo no reporta a nadie en el organigrama.
          </Text>
        )}
      </View>

      <View style={[estilos.cargo, estilos.usted]}>
        <Text style={estilos.tenue}>Usted</Text>
        <Text style={estilos.cargoNombre}>{cargo?.nombre}</Text>
        {linea.companeros?.length ? (
          <>
            <Text style={estilos.tenue}>Comparten su cargo:</Text>
            <Personas personas={linea.companeros} />
          </>
        ) : null}
      </View>

      <View style={estilos.grupo}>
        <View style={estilos.grupoCabecera}>
          <Icono
            nombre="arrow-down-circle-outline"
            size={20}
            color={colores.tintaSuave}
          />
          <Text style={estilos.subtitulo}>Supervisa</Text>
        </View>
        {linea.supervisa?.length ? (
          linea.supervisa.map((c) => (
            <Cargo key={c.id} cargo={c} nivel="abajo" />
          ))
        ) : (
          <Text style={estilos.tenue}>
            Ningún cargo le reporta directamente.
          </Text>
        )}
      </View>
    </Tarjeta>
  );
}

/** «Daniel Peñarreta» de «Daniel Alejandro» y «Peñarreta Torres»: el
 * primer nombre y el primer apellido. */
export function nombreCorto(nombres, apellidos) {
  const primero = (texto) =>
    String(texto ?? "")
      .trim()
      .split(/\s+/)[0] || "";
  return [primero(nombres), primero(apellidos)].filter(Boolean).join(" ");
}

/**
 * El encabezado de «Mi perfil» (16/11/2026, a pedido del usuario): un nombre
 * y un apellido con el código de empleado al lado (solo si tiene uno
 * registrado) y, debajo, el cargo en lugar del correo.
 */
function Encabezado({ usuario, datos }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const nombre =
    nombreCorto(
      datos?.nombres ?? usuario?.first_name,
      datos?.apellidos ?? usuario?.last_name,
    ) ||
    usuario?.username ||
    "";
  const codigo = String(
    datos?.codigo_empleado ?? usuario?.codigo_empleado ?? "",
  ).trim();
  const cargo = datos?.cargo?.nombre;
  return (
    <View style={estilos.encabezado} testID="encabezado-perfil">
      <View style={estilos.filaNombre}>
        <Text style={estilos.nombre} accessibilityRole="header">
          {nombre}
        </Text>
        {codigo ? (
          <View
            style={estilos.codigo}
            accessible
            accessibilityLabel={`Código de empleado ${codigo}`}
            testID="codigo-empleado"
          >
            <Text style={estilos.codigoTexto}>{codigo}</Text>
          </View>
        ) : null}
      </View>
      {cargo ? <Text style={estilos.cargoEncabezado}>{cargo}</Text> : null}
    </View>
  );
}

/** Los tres bloques de «Mi perfil», con su carga, error y «Editar en el
 * navegador». Se vuelve a pedir al cambiar de empresa. */
export function MiPerfil({ usuario } = {}) {
  const estilos = useEstilos(fabricaDeEstilos);
  const { empresaActiva, versionEmpresa } = useSesion();
  const [carga, setCarga] = useState({ estado: "cargando", datos: null });
  const consulta = useRef(0);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(async () => {
    const numero = ++consulta.current;
    setCarga((c) => ({ ...c, estado: "cargando" }));
    try {
      const datos = await inicioService.misDatos();
      if (montado.current && numero === consulta.current)
        setCarga({ estado: "listo", datos: datos ?? {} });
    } catch {
      if (montado.current && numero === consulta.current)
        setCarga({ estado: "error", datos: null });
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar, versionEmpresa]);

  if (carga.estado === "cargando" && !carga.datos)
    return (
      <View style={estilos.contenedor}>
        <Encabezado usuario={usuario} />
        <Cargando texto="Cargando su perfil…" />
      </View>
    );
  if (carga.estado === "error")
    return (
      <View style={estilos.contenedor}>
        <Encabezado usuario={usuario} />
        <ErrorConReintento
          texto="No se pudo cargar su perfil."
          onReintentar={cargar}
        />
      </View>
    );

  const d = carga.datos;
  const telefono = telefonoAMostrar(d);
  const lineaFija = lineaFijaAMostrar(d);
  return (
    <View style={estilos.contenedor} testID="mi-perfil">
      <Encabezado usuario={usuario} datos={d} />
      <Tarjeta
        icono="card-account-details-outline"
        titulo="Mis datos"
        descripcion="Con ellos se cargan sus pedidos de soporte: manténgalos al día."
        testID="mis-datos"
      >
        {d.faltan?.length ? (
          <Alerta
            tipo="aviso"
            texto={`Le falta completar: ${queFalta(d.faltan)}.`}
          />
        ) : null}
        <Dato etiqueta="Nombres" valor={d.nombres} />
        <Dato etiqueta="Apellidos" valor={d.apellidos} />
        <Dato etiqueta="Correo" valor={d.correo} />
        <Dato etiqueta="Código de empleado" valor={d.codigo_empleado} />
        {/* US-028 (CA-2): la cédula de nómina (c33d146), solo si el servidor
            la envía, como la web (`{datos.cedula && …}`). */}
        {d.cedula ? (
          <Dato
            etiqueta="Cédula"
            valor={d.cedula}
            nota="Viene de nómina. Si no es correcta, avise a Talento Humano."
            testID="mi-cedula"
          />
        ) : null}
        <Dato
          etiqueta={telefono.etiqueta}
          valor={telefono.valor}
          testID="mi-telefono"
        />
        <Dato
          etiqueta="¿Tiene línea fija?"
          valor={lineaFija.respuesta}
          testID="mi-linea-fija"
        />
        {lineaFija.extension !== null ? (
          <Dato
            etiqueta="Extensión de su línea fija"
            valor={lineaFija.extension}
            testID="mi-extension"
          />
        ) : null}
        <Dato etiqueta="Cargo" valor={d.cargo?.nombre} />
        <Dato etiqueta="Área" valor={d.area?.nombre} />
        <Dato etiqueta="Agencia" valor={d.agencia?.nombre} />
        <AbrirEnLaWeb
          testID="editar-perfil"
          ruta="/admin/perfil"
          empresa={empresaActiva?.id}
          titulo="Editar en el navegador"
          nombre="Editar mi perfil"
          icono="account-edit-outline"
          familia="perfil"
          texto="En la app su perfil solo se consulta. Para cambiarlo, ábralo en el navegador."
        />
      </Tarjeta>
      <MiCargo perfil={d.cargo_perfil} />
      <MiSupervision linea={d.supervision} cargo={d.cargo} />
    </View>
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  contenedor: { gap: 16 },
  encabezado: { gap: 4 },
  filaNombre: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  nombre: {
    flexShrink: 1,
    fontSize: 22,
    fontWeight: "700",
    color: colores.tinta,
  },
  codigo: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: colores.hundido,
  },
  codigoTexto: { fontSize: 13, fontWeight: "600", color: colores.tintaSuave },
  cargoEncabezado: { fontSize: 16, color: colores.tintaSuave },
  tarjeta: {
    gap: 10,
    padding: 14,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  tarjetaCabecera: { flexDirection: "row", alignItems: "center", gap: 8 },
  tarjetaTitulo: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: colores.tinta,
  },
  subtitulo: { fontSize: 15, fontWeight: "700", color: colores.tinta },
  texto: { fontSize: 15, color: colores.tinta, flexShrink: 1 },
  tenue: { fontSize: 14, color: colores.tintaTenue, flexShrink: 1 },
  dato: {
    gap: 1,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: colores.hundido,
  },
  datoEtiqueta: { fontSize: 13, color: colores.tintaTenue },
  datoValor: { fontSize: 16, color: colores.tinta },
  datoVacio: { color: colores.tintaTenue },
  datoNota: { fontSize: 13, color: colores.tintaTenue },
  lista: { gap: 6, paddingBottom: 4 },
  itemLista: { flexDirection: "row", gap: 6 },
  numeroLista: { fontSize: 15, fontWeight: "600", color: colores.tintaSuave },
  textoLista: { flex: 1, fontSize: 15, color: colores.tinta },
  grupo: { gap: 8 },
  grupoCabecera: { flexDirection: "row", alignItems: "center", gap: 6 },
  cargo: {
    gap: 4,
    padding: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: colores.bordeFuerte,
    backgroundColor: colores.fondo,
  },
  usted: { borderLeftColor: colores.acento, backgroundColor: colores.realce },
  cargoNombre: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  personas: { gap: 4 },
  persona: { flexDirection: "row", alignItems: "center", gap: 6 },
});
