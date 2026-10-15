import { useEffect, useState } from "react";

import { matrizService } from "../../api/matrizService";

/**
 * Lo que eligen los formularios y filtros de la Matriz: catálogos y personas
 * de la empresa activa, pedidos una vez por pantalla.
 */
export function useOpcionesMatriz() {
  const [opciones, setOpciones] = useState({
    cargando: true,
    areas: [],
    entidades: [],
    sedes: [],
    tipos: [],
    periodicidades: [],
    prioridades: [],
    etapas: [],
    personas: [],
  });

  useEffect(() => {
    let vigente = true;
    Promise.all([matrizService.catalogos(), matrizService.personas()])
      .then(([catalogos, personas]) => {
        if (vigente) setOpciones({ ...catalogos, personas, cargando: false });
      })
      .catch(() => {
        if (vigente) setOpciones((actual) => ({ ...actual, cargando: false }));
      });
    return () => {
      vigente = false;
    };
  }, []);

  return opciones;
}
