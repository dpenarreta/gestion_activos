import { useCallback, useEffect, useRef, useState } from "react";

import { ordenesService } from "../api/servicios";
import { mensajeDeOrdenes } from "./formato";

/**
 * `GET ordenes/catalogos/` (US-025): las sedes activas, las categorías, las
 * prioridades y, para quien coordina, los técnicos y los proveedores. Lo
 * piden «Nueva orden», «Corregir» y «Asignar». Una respuesta tardía no llega
 * a una pantalla que ya se fue.
 */
export function useCatalogosDeOrdenes(activo = true) {
  // «inactivo» hasta que haga falta (la ficha los pide solo si se puede
  // asignar o corregir; QA-TECH, 17/11/2026: una sola carga por ficha).
  const [carga, setCarga] = useState({ estado: activo ? "cargando" : "inactivo", datos: null, error: null });
  const montado = useRef(true);
  const consulta = useRef(0);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(async () => {
    const numero = ++consulta.current;
    setCarga({ estado: "cargando", datos: null, error: null });
    try {
      const datos = await ordenesService.catalogos();
      if (!montado.current || numero !== consulta.current) return;
      setCarga({ estado: "listo", datos, error: null });
    } catch (e) {
      if (!montado.current || numero !== consulta.current) return;
      setCarga({ estado: "error", datos: null, error: mensajeDeOrdenes(e, "No se pudieron cargar las sedes y las categorías.") });
    }
  }, []);

  // Una sola vez: al pasar a activo. Después se recargan solo con `recargar`.
  const pedido = useRef(false);
  useEffect(() => {
    if (!activo || pedido.current) return;
    pedido.current = true;
    cargar();
  }, [activo, cargar]);

  return { ...carga, recargar: cargar };
}

/** `[{valor, texto}]` de una lista `{valor, etiqueta}` del catálogo. */
export function opcionesDe(lista) {
  return (Array.isArray(lista) ? lista : []).map((o) => ({ valor: o.valor, texto: o.etiqueta }));
}

/** Las sedes como opciones, con la ciudad y la región de detalle. */
export function opcionesDeSedes(lista) {
  return (Array.isArray(lista) ? lista : []).map((s) => ({
    valor: String(s.id),
    texto: s.nombre,
    detalle: [s.ciudad && s.ciudad !== s.nombre ? s.ciudad : null, s.region_display].filter(Boolean).join(" · ") || undefined,
  }));
}

/** Personas o proveedores (`{id, nombre}`) como opciones, con la actual al
 * principio si ya no está (un técnico que perdió el permiso sigue a la
 * vista mientras no se cambie). */
export function opcionesDeNombres(lista, actual) {
  const opciones = (Array.isArray(lista) ? lista : []).map((x) => ({ valor: String(x.id), texto: x.nombre }));
  if (actual?.id && !opciones.some((o) => o.valor === String(actual.id))) {
    opciones.unshift({ valor: String(actual.id), texto: actual.nombre });
  }
  return opciones;
}
