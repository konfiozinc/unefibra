/* ============================================================
 * UNEFIBRAS SAS — Admin: envoltura de Cloud Functions
 * ------------------------------------------------------------
 * Devuelve una función callable lista para usar. Las funciones
 * validan el rol del llamador en el servidor (verificarRol).
 * ============================================================ */

import { app } from "./core.js";
import { getFunctions, httpsCallable } from "firebase/functions";

const functions = getFunctions(app);

export function call(nombre) {
  return httpsCallable(functions, nombre);
}
