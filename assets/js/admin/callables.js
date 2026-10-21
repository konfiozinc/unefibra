/* ============================================================
 * UneFibra SAS — Admin: envoltura de Cloud Functions
 * ------------------------------------------------------------
 * Devuelve una función callable lista para usar. Las funciones
 * validan el rol del llamador en el servidor (verificarRol).
 * ============================================================ */

import { app } from "./core.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "firebase/functions";

const functions = getFunctions(app);
const CFG = window.UNEFIBRAS_CONFIG;
if (new URLSearchParams(window.location.search).get("emulador") === "1" && CFG && CFG.emulador) {
  connectFunctionsEmulator(functions, CFG.emulador.host, CFG.emulador.functionsPort);
}

export function call(nombre) {
  return httpsCallable(functions, nombre);
}
