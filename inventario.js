/**
 * CAFETERÍA ARIES - PANEL DE INVENTARIO, INSUMOS Y RECETAS
 * Precarga inmediata en caché (localStorage) + Auto-refresco con Google Sheets
 * Desarrollado por DIGITALITY
 */

const API_URL = "https://script.google.com/macros/s/AKfycbzbv7a6fO2JgnlP8BOcuMySchEjHC2IkLv3sN6rJnuNyTXj-FPPTjbVRUzmt5EU1T9X/exec";
const INTERVALO_AUTO_REFRESH_INV_MS = 30000; // Auto-refresco cada 30 segundos

let invState = {
  insumos: [],
  productos: [],
  busquedaInsumo: '',
  soloBajos: false,
  busquedaProd: '',
  catProd: 'Todas'
};

let timerAutoRefreshInv = null;
let sincronizandoInv = false;

// =========================================================
// PRECARGA INMEDIATA ANTES DEL RENDERIZADO (0ms DE ESPERA)
// =========================================================
(function precargarCacheInventario() {
  try {
    invState.insumos = JSON.parse(localStorage.getItem('aries_insumos') || '[]');
    invState.productos = JSON.parse(localStorage.getItem('aries_productos') || '[]');
  } catch (e) {
    console.warn('No se pudo leer caché inicial de inventario:', e);
  }
})();

const promesaInicialInventario = fetch(`${API_URL}?action=getData&t=${Date.now()}`)
  .then(res => res.json())
  .catch(() => null);

// =========================================================
// INICIALIZACIÓN DEL DOM
// =========================================================
document.addEventListener('DOMContentLoaded', async () => {
  configurarEventosInventario();

  const habiaCache = invState.insumos.length > 0 || invState.productos.length > 0;
  if (habiaCache) {
    actualizarTodoInventario();
    setSyncStatus(true, 'Actualizando inventario...');
  } else {
    mostrarSkeletonInventario();
    setSyncStatus(true, 'Precargando desde Sheets...');
  }

  const dataInicial = await promesaInicialInventario;
  if (dataInicial && dataInicial.status === 'success') {
    procesarYGuardarDatosInventario(dataInicial);
    actualizarTodoInventario();
    setSyncStatus(false, 'Conectado');
  } else {
    await cargarDatosInventario(habiaCache);
  }

  iniciarAutoRefreshInventario();

  window.addEventListener('storage', (e) => {
    if (['aries_insumos', 'aries_productos'].includes(e.key)) {
      cargarLocalInventario();
      actualizarTodoInventario();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      cargarDatosInventario(true);
    }
  });
});

function iniciarAutoRefreshInventario() {
  if (timerAutoRefreshInv) clearInterval(timerAutoRefreshInv);
  timerAutoRefreshInv = setInterval(() => {
    if (!document.hidden) {
      cargarDatosInventario(true);
    }
  }, INTERVALO_AUTO_REFRESH_INV_MS);
}

function mostrarSkeletonInventario() {
  const contProd = document.getElementById('lista-productos-inv');
  const tbodyIns = document.getElementById('tabla-insumos');

  if (contProd) {
    contProd.innerHTML = `
      <div style="text-align:center; padding: 2.5rem 1rem; color: var(--text-muted);">
        <i class="ri-loader-4-line" style="font-size: 2rem; display:inline-block; animation: spin 1s linear infinite; margin-bottom:0.5rem;"></i>
        <p><strong>Precargando productos y recetas desde Google Sheets...</strong></p>
        <p style="font-size:0.82rem; margin-top:0.25rem;">Se guardarán en caché para que la próxima carga sea instantánea.</p>
      </div>
      <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
    `;
  }

  if (tbodyIns) {
    tbodyIns.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; color:var(--text-muted); padding:2rem;">
          Cargando insumos desde Google Sheets...
        </td>
      </tr>
    `;
  }
}

function procesarYGuardarDatosInventario(data) {
  invState.insumos = (data.insumos || []).map(i => ({
    ...i,
    stock: parseFloat(i.stock) || 0,
    minimo: parseFloat(i.minimo) || 0
  }));

  invState.productos = (data.productos || []).map(p => {
    let recetaParsed = [];
    try {
      recetaParsed = typeof p.receta === 'string' && p.receta.trim() !== ''
        ? JSON.parse(p.receta)
        : (Array.isArray(p.receta) ? p.receta : []);
    } catch (e) {
      recetaParsed = [];
    }

    const esPostre = p.categoria === 'Postres' || p.usaReceta === 'NO' || p.usaReceta === false;
    return {
      ...p,
      precio: parseFloat(p.precio) || 0,
      usaReceta: !esPostre && recetaParsed.length > 0,
      receta: esPostre ? [] : recetaParsed
    };
  });

  guardarLocalInventario();
}

function cargarLocalInventario() {
  try {
    invState.insumos = JSON.parse(localStorage.getItem('aries_insumos') || '[]');
    invState.productos = JSON.parse(localStorage.getItem('aries_productos') || '[]');
  } catch (e) {}
}

async function cargarDatosInventario(silencioso = false) {
  if (sincronizandoInv) return;
  sincronizandoInv = true;
  setSyncStatus(true, silencioso ? 'Sincronizando...' : 'Consultando Sheets...');

  try {
    const res = await fetch(`${API_URL}?action=getData&t=${Date.now()}`);
    const data = await res.json();

    if (data.status === 'success') {
      procesarYGuardarDatosInventario(data);
      actualizarTodoInventario();
      setSyncStatus(false, 'Conectado');
    } else {
      throw new Error(data.message || 'Error leyendo Sheets');
    }
  } catch (err) {
    console.error('Error al cargar inventario:', err);
    cargarLocalInventario();
    actualizarTodoInventario();
    setSyncStatus(false, 'Modo Local (Caché)');
    if (!silencioso) {
      mostrarToast('Sin conexión con Google Sheets. Mostrando datos en caché.', 'warning');
    }
  } finally {
    sincronizandoInv = false;
  }
}

function guardarLocalInventario() {
  localStorage.setItem('aries_insumos', JSON.stringify(invState.insumos));
  localStorage.setItem('aries_productos', JSON.stringify(invState.productos));
}

function actualizarTodoInventario() {
  actualizarKPIsInventario();
  verificarAlertasInventario();
  renderizarTablaInsumos();
  renderizarListaProductos();

  const contReceta = document.getElementById('lista-ingredientes-receta');
  if (contReceta && contReceta.children.length === 0 && !document.getElementById('prod-id').value) {
    agregarFilaIngrediente();
  }
}

// =========================================================
// KPIs Y ALERTAS
// =========================================================
function actualizarKPIsInventario() {
  const bajos = invState.insumos.filter(i => i.stock <= i.minimo).length;
  const postres = invState.productos.filter(p => p.categoria === 'Postres' || !p.usaReceta).length;
  const bebidas = invState.productos.length - postres;

  document.getElementById('kpi-total-insumos').textContent = invState.insumos.length;
  document.getElementById('kpi-insumos-bajos').textContent = bajos;
  document.getElementById('kpi-total-bebidas').textContent = bebidas;
  document.getElementById('kpi-total-postres').textContent = postres;
}

function verificarAlertasInventario() {
  const bajos = invState.insumos.filter(i => i.stock <= i.minimo);
  const banner = document.getElementById('alerta-banner');
  const mensaje = document.getElementById('alerta-mensaje');

  if (bajos.length > 0) {
    banner.classList.remove('hidden');
    const nombres = bajos.map(i => `${i.nombre} (${i.stock} ${i.unidad})`).join(', ');
    mensaje.textContent = `¡Insumos por terminarse! Reabastecer: ${nombres}`;
  } else {
    banner.classList.add('hidden');
  }
}

function cambiarTabInventario(tabId, btn) {
  document.querySelectorAll('.subpanel-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.subpanel-view').forEach(v => v.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
}

// =========================================================
// EVENTOS Y FORMULARIOS
// =========================================================
function configurarEventosInventario() {
  document.getElementById('buscar-insumo').addEventListener('input', (e) => {
    invState.busquedaInsumo = e.target.value.toLowerCase();
    renderizarTablaInsumos();
  });

  document.getElementById('solo-bajos').addEventListener('change', (e) => {
    invState.soloBajos = e.target.checked;
    renderizarTablaInsumos();
  });

  document.getElementById('buscar-prod-inv').addEventListener('input', (e) => {
    invState.busquedaProd = e.target.value.toLowerCase();
    renderizarListaProductos();
  });

  document.getElementById('filtro-cat-inv').addEventListener('change', (e) => {
    invState.catProd = e.target.value;
    renderizarListaProductos();
  });

  document.getElementById('form-insumo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const idEdit = document.getElementById('insumo-id').value;
    const payload = {
      id: idEdit || 'INS-' + Date.now(),
      nombre: document.getElementById('insumo-nombre').value.trim(),
      unidad: document.getElementById('insumo-unidad').value,
      stock: parseFloat(document.getElementById('insumo-stock').value) || 0,
      minimo: parseFloat(document.getElementById('insumo-minimo').value) || 0
    };

    if (idEdit) {
      const idx = invState.insumos.findIndex(i => i.id === idEdit);
      if (idx !== -1) invState.insumos[idx] = payload;
    } else {
      invState.insumos.push(payload);
    }

    guardarLocalInventario();
    resetFormInsumo();
    actualizarTodoInventario();
    mostrarToast(idEdit ? 'Insumo actualizado en Sheets' : 'Insumo agregado al almacén', 'success');

    await enviarASheets('guardarInsumo', payload);
  });

  document.getElementById('form-reabastecer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('reab-id').value;
    const cantidad = parseFloat(document.getElementById('reab-cantidad').value) || 0;
    if (cantidad <= 0) return;

    const insumo = invState.insumos.find(i => i.id === id);
    if (insumo) {
      insumo.stock = parseFloat((insumo.stock + cantidad).toFixed(2));
    }

    guardarLocalInventario();
    cerrarModal('modal-reabastecer');
    actualizarTodoInventario();
    mostrarToast(`+${cantidad} ${insumo ? insumo.unidad : ''} sumados a ${insumo ? insumo.nombre : ''}`, 'success');

    await enviarASheets('reabastecerInsumo', { id, cantidad });
  });

  document.getElementById('form-producto').addEventListener('submit', async (e) => {
    e.preventDefault();
    const idEdit = document.getElementById('prod-id').value;
    const categoria = document.getElementById('prod-categoria').value;
    const esPostre = categoria === 'Postres';

    let receta = [];
    if (!esPostre) {
      const filas = document.querySelectorAll('.ingrediente-row');
      filas.forEach(fila => {
        const idInsumo = fila.querySelector('.sel-ing-insumo').value;
        const cantidad = parseFloat(fila.querySelector('.inp-ing-cant').value) || 0;
        if (idInsumo && cantidad > 0) {
          const yaExiste = receta.find(r => r.idInsumo === idInsumo);
          if (yaExiste) {
            yaExiste.cantidad = parseFloat((yaExiste.cantidad + cantidad).toFixed(2));
          } else {
            receta.push({ idInsumo, cantidad });
          }
        }
      });

      if (receta.length === 0) {
        mostrarToast('Agrega al menos 1 insumo válido a la receta o selecciona categoría Postres.', 'warning');
        return;
      }
    }

    const payload = {
      id: idEdit || 'PROD-' + Date.now(),
      nombre: document.getElementById('prod-nombre').value.trim(),
      categoria: categoria,
      precio: parseFloat(document.getElementById('prod-precio').value) || 0,
      usaReceta: !esPostre && receta.length > 0,
      receta: esPostre ? [] : receta
    };

    if (idEdit) {
      const idx = invState.productos.findIndex(p => p.id === idEdit);
      if (idx !== -1) invState.productos[idx] = payload;
    } else {
      invState.productos.push(payload);
    }

    guardarLocalInventario();
    resetFormProducto();
    actualizarTodoInventario();
    mostrarToast(idEdit ? 'Producto actualizado en Sheets' : 'Producto guardado en menú', 'success');

    await enviarASheets('guardarProducto', payload);
  });
}

// =========================================================
// CRUD INSUMOS (RENDER, EDITAR, REABASTECER, ELIMINAR)
// =========================================================
function renderizarTablaInsumos() {
  const tbody = document.getElementById('tabla-insumos');
  if (!tbody) return;

  const filtrados = invState.insumos.filter(i => {
    const coincideNombre = i.nombre.toLowerCase().includes(invState.busquedaInsumo);
    const coincideBajo = !invState.soloBajos || i.stock <= i.minimo;
    return coincideNombre && coincideBajo;
  });

  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1.5rem;">No hay insumos registrados que coincidan con el filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(ins => {
    const esCritico = ins.stock === 0;
    const esBajo = ins.stock <= ins.minimo;
    let estadoHTML = `<span class="pill-tipo pill-ingreso">Óptimo</span>`;
    if (esCritico) {
      estadoHTML = `<span class="pill-tipo pill-egreso">Agotado</span>`;
    } else if (esBajo) {
      estadoHTML = `<span class="pill-tipo pill-warning">Stock Bajo</span>`;
    }

    return `
      <tr>
        <td><strong>${ins.nombre}</strong><br><small style="color:var(--text-muted)">${ins.id}</small></td>
        <td><strong>${ins.stock}</strong> ${ins.unidad}</td>
        <td>${ins.minimo} ${ins.unidad}</td>
        <td>${estadoHTML}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn-icon-action success" title="Reabastecer (+)" onclick="abrirModalReabastecer('${ins.id}')">
            <i class="ri-add-line"></i>
          </button>
          <button class="btn-icon-action info" title="Editar" onclick="editarInsumo('${ins.id}')">
            <i class="ri-pencil-line"></i>
          </button>
          <button class="btn-icon-action danger" title="Eliminar" onclick="eliminarInsumo('${ins.id}')">
            <i class="ri-delete-bin-line"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function editarInsumo(id) {
  const ins = invState.insumos.find(i => i.id === id);
  if (!ins) return;

  document.getElementById('insumo-id').value = ins.id;
  document.getElementById('insumo-nombre').value = ins.nombre;
  document.getElementById('insumo-unidad').value = ins.unidad;
  document.getElementById('insumo-stock').value = ins.stock;
  document.getElementById('insumo-minimo').value = ins.minimo;

  document.getElementById('titulo-form-insumo').innerHTML = `<i class="ri-pencil-line"></i> Editando Insumo`;
  document.getElementById('btn-guardar-insumo').innerHTML = `<i class="ri-check-line"></i> Actualizar Insumo`;
  document.getElementById('btn-cancelar-insumo').classList.remove('hidden');

  document.getElementById('card-form-insumo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetFormInsumo() {
  document.getElementById('form-insumo').reset();
  document.getElementById('insumo-id').value = '';
  document.getElementById('titulo-form-insumo').innerHTML = `<i class="ri-add-circle-line"></i> Nuevo Insumo`;
  document.getElementById('btn-guardar-insumo').innerHTML = `<i class="ri-save-3-line"></i> Guardar Insumo`;
  document.getElementById('btn-cancelar-insumo').classList.add('hidden');
}

function abrirModalReabastecer(id) {
  const ins = invState.insumos.find(i => i.id === id);
  if (!ins) return;

  document.getElementById('reab-id').value = ins.id;
  document.getElementById('reab-nombre').textContent = ins.nombre;
  document.getElementById('reab-actual').textContent = `${ins.stock} ${ins.unidad}`;
  document.getElementById('reab-unidad').textContent = ins.unidad;
  document.getElementById('reab-cantidad').value = '';
  document.getElementById('modal-reabastecer').classList.add('open');
}

async function eliminarInsumo(id) {
  const ins = invState.insumos.find(i => i.id === id);
  if (!ins) return;

  const usadoEn = invState.productos.filter(p => (p.receta || []).some(r => r.idInsumo === id));
  if (usadoEn.length > 0) {
    const nombresProd = usadoEn.map(p => p.nombre).join(', ');
    if (!confirm(`Este insumo se usa en: ${nombresProd}. ¿Seguro que deseas eliminarlo?`)) return;
  } else {
    if (!confirm(`¿Eliminar el insumo "${ins.nombre}" de Google Sheets?`)) return;
  }

  invState.insumos = invState.insumos.filter(i => i.id !== id);
  guardarLocalInventario();
  actualizarTodoInventario();
  mostrarToast('Insumo eliminado', 'warning');

  await enviarASheets('eliminarInsumo', { id });
}

// =========================================================
// CRUD PRODUCTOS Y CONSTRUCTOR DE RECETAS
// =========================================================
function manejarCambioCategoria() {
  const cat = document.getElementById('prod-categoria').value;
  const esPostre = cat === 'Postres';
  document.getElementById('bloque-receta').classList.toggle('hidden', esPostre);
  document.getElementById('aviso-postre-directo').classList.toggle('hidden', !esPostre);
}

function agregarFilaIngrediente(idSeleccionado = '', cantidadVal = '') {
  const container = document.getElementById('lista-ingredientes-receta');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'ingrediente-row';

  const opcionesInsumos = invState.insumos.map(ins =>
    `<option value="${ins.id}" ${ins.id === idSeleccionado ? 'selected' : ''}>${ins.nombre} (${ins.unidad})</option>`
  ).join('');

  row.innerHTML = `
    <select class="sel-ing-insumo" required>
      <option value="">-- Selecciona insumo --</option>
      ${opcionesInsumos}
    </select>
    <input type="number" class="inp-ing-cant" step="0.01" min="0.01" inputmode="decimal" placeholder="Cant." value="${cantidadVal}" required>
    <button type="button" class="btn-remove-ing" onclick="this.parentElement.remove()" title="Quitar ingrediente">
      <i class="ri-close-line"></i>
    </button>
  `;
  container.appendChild(row);
}

function calcularPorcionesDisponibles(prod) {
  if (prod.categoria === 'Postres' || !prod.usaReceta || !prod.receta || prod.receta.length === 0) {
    return null;
  }
  let minPorciones = Infinity;
  for (const item of prod.receta) {
    const insumo = invState.insumos.find(i => i.id === item.idInsumo);
    if (!insumo || item.cantidad <= 0) return 0;
    const posibles = Math.floor(insumo.stock / item.cantidad);
    if (posibles < minPorciones) minPorciones = posibles;
  }
  return minPorciones === Infinity ? 0 : minPorciones;
}

function renderizarListaProductos() {
  const container = document.getElementById('lista-productos-inv');
  if (!container) return;

  const filtrados = invState.productos.filter(p => {
    const coincideCat = invState.catProd === 'Todas' || p.categoria === invState.catProd;
    const coincideBusq = p.nombre.toLowerCase().includes(invState.busquedaProd);
    return coincideCat && coincideBusq;
  });

  if (filtrados.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted); text-align:center; padding:2rem;">No hay productos registrados en esta categoría.</p>`;
    return;
  }

  container.innerHTML = filtrados.map(prod => {
    const esPostre = prod.categoria === 'Postres' || !prod.usaReceta;
    const porciones = calcularPorcionesDisponibles(prod);

    let recetaHTML = '';
    if (esPostre) {
      recetaHTML = `<span class="badge-directo"><i class="ri-cake-3-line"></i> Venta directa (sin descuento de insumos)</span>`;
    } else {
      const listaIngs = (prod.receta || []).map(r => {
        const ins = invState.insumos.find(i => i.id === r.idInsumo);
        return ins ? `${r.cantidad} ${ins.unidad} de ${ins.nombre}` : `Insumo eliminado (${r.cantidad})`;
      }).join(' • ');
      recetaHTML = `
        <div class="receta-resumen-text"><strong>Receta:</strong> ${listaIngs}</div>
        <div class="porciones-tag ${porciones === 0 ? 'agotado' : ''}">
          ${porciones === 0 ? 'Sin stock suficiente para preparar' : `Alcanza para preparar aprox. <strong>${porciones}</strong> unidades`}
        </div>
      `;
    }

    return `
      <div class="prod-inv-item">
        <div class="prod-inv-main">
          <div class="prod-inv-top">
            <span class="prod-cat-tag ${esPostre ? 'postre' : ''}">${prod.categoria}</span>
            <h4>${prod.nombre}</h4>
            <strong class="prod-inv-price">$${prod.precio.toFixed(2)}</strong>
          </div>
          ${recetaHTML}
        </div>
        <div class="prod-inv-actions">
          <button class="btn-icon-action info" title="Editar producto" onclick="editarProducto('${prod.id}')">
            <i class="ri-pencil-line"></i>
          </button>
          <button class="btn-icon-action danger" title="Eliminar producto" onclick="eliminarProducto('${prod.id}')">
            <i class="ri-delete-bin-line"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function editarProducto(id) {
  const prod = invState.productos.find(p => p.id === id);
  if (!prod) return;

  document.getElementById('prod-id').value = prod.id;
  document.getElementById('prod-nombre').value = prod.nombre;
  document.getElementById('prod-categoria').value = prod.categoria;
  document.getElementById('prod-precio').value = prod.precio;

  manejarCambioCategoria();

  const container = document.getElementById('lista-ingredientes-receta');
  container.innerHTML = '';

  if (prod.categoria !== 'Postres' && Array.isArray(prod.receta) && prod.receta.length > 0) {
    prod.receta.forEach(ing => agregarFilaIngrediente(ing.idInsumo, ing.cantidad));
  } else if (prod.categoria !== 'Postres') {
    agregarFilaIngrediente();
  }

  document.getElementById('titulo-form-producto').innerHTML = `<i class="ri-pencil-line"></i> Editando Producto`;
  document.getElementById('btn-guardar-producto').innerHTML = `<i class="ri-check-line"></i> Actualizar Producto`;
  document.getElementById('btn-cancelar-producto').classList.remove('hidden');

  document.getElementById('card-form-producto')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetFormProducto() {
  document.getElementById('form-producto').reset();
  document.getElementById('prod-id').value = '';
  document.getElementById('prod-categoria').value = 'Calientes';
  manejarCambioCategoria();

  const container = document.getElementById('lista-ingredientes-receta');
  container.innerHTML = '';
  agregarFilaIngrediente();

  document.getElementById('titulo-form-producto').innerHTML = `<i class="ri-cup-line"></i> Nuevo Producto`;
  document.getElementById('btn-guardar-producto').innerHTML = `<i class="ri-save-3-line"></i> Guardar en Menú`;
  document.getElementById('btn-cancelar-producto').classList.add('hidden');
}

async function eliminarProducto(id) {
  const prod = invState.productos.find(p => p.id === id);
  if (!prod) return;
  if (!confirm(`¿Eliminar "${prod.nombre}" del menú y de Google Sheets?`)) return;

  invState.productos = invState.productos.filter(p => p.id !== id);
  guardarLocalInventario();
  actualizarTodoInventario();
  mostrarToast('Producto eliminado del menú', 'warning');

  await enviarASheets('eliminarProducto', { id });
}

// =========================================================
// CONEXIÓN CON GOOGLE SHEETS Y UTILIDADES
// =========================================================
async function enviarASheets(action, payload) {
  setSyncStatus(true, 'Guardando en Sheets...');
  try {
    await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({ action, payload })
    });
    setSyncStatus(false, 'Conectado');
  } catch (err) {
    console.error('Error enviando a Sheets:', err);
    setSyncStatus(false, 'Error de red');
    mostrarToast('Error al sincronizar con Google Sheets.', 'error');
  }
}

function cerrarModal(id) { document.getElementById(id).classList.remove('open'); }

function setSyncStatus(syncing, text) {
  const dot = document.querySelector('.status-sync .dot');
  const label = document.getElementById('sync-text');
  if (dot) dot.classList.toggle('syncing', syncing);
  if (label) label.textContent = text;
}

function mostrarToast(mensaje, tipo = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.textContent = mensaje;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 3800);
}