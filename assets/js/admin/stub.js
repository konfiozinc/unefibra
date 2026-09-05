/* ============================================================
 * UNEFIBRAS SAS — Admin: placeholder honesto de módulos
 * ------------------------------------------------------------
 * Renderiza el shell y un aviso claro de que el módulo se
 * implementará en una fase posterior. NO usa datos simulados.
 * ============================================================ */

import { requireAuth } from "./shell.js";

export async function initStub(activeKey, titulo, fase) {
  const ctx = await requireAuth(activeKey);
  if (!ctx) return;

  const content = document.getElementById("app-content");
  if (!content) return;

  content.innerHTML = `
    <div class="stub">
      <h1>${titulo}</h1>
      <p>Este módulo se implementará en la ${fase}. No contiene datos simulados.</p>
      <a class="btn btn--primary" href="dashboard.html">Volver al Dashboard</a>
    </div>`;
}
