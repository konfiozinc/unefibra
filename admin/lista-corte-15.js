/* ============================================================
 * UneFibra SAS — Admin: lista de clientes con CORTE EL DÍA 15
 * ------------------------------------------------------------
 * Página fina a propósito: toda la lógica vive en el módulo
 * compartido assets/js/admin/cortes.js, que usan las dos listas.
 * Así no se pueden desincronizar.
 * ============================================================ */

import { iniciarListaCorte } from "../assets/js/admin/cortes.js";

iniciarListaCorte("15", "corte15");
