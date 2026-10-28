// ---------- Utilidades ----------
const $ = (id) => document.getElementById(id);

function setTexto(id, valor) {
    const el = $(id);
    if (el) el.textContent = valor;
}

function setDisplay(id, valor) {
    const el = $(id);
    if (el) el.style.display = valor;
}

// ---------- Mapa ----------
const mapa = L.map('mapa', { zoomControl: false }).setView([10.9878, -74.7889], 15);
L.control.zoom({ position: 'bottomleft' }).addTo(mapa);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(mapa);

function iconoColor(color) {
    return L.divIcon({
        className: '',
        html: '<div style="width:22px;height:22px;border-radius:50%;background:' + color +
              ';border:3px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.6)"></div>',
        iconSize: [22, 22], iconAnchor: [11, 11]
    });
}
const COLOR_AUTO1 = '#1D9E75';   // cambia aqui el color del auto 1
const COLOR_AUTO2 = '#3B7DDD';   // cambia aqui el color del auto 2
const marcador = L.marker([10.9878, -74.7889], { icon: iconoColor(COLOR_AUTO1) }).addTo(mapa);
const linea = L.polyline([], { color: '#1D9E75', weight: 4 }).addTo(mapa);
const marcador2 = L.marker([10.9878, -74.7889], { opacity: 0, icon: iconoColor(COLOR_AUTO2) }).addTo(mapa);
const linea2 = L.polyline([], { color: '#3B7DDD', weight: 4 }).addTo(mapa);
let ultimoId2 = 0;
let puntos2 = [];
async function actualizarAuto2() {
    const r = await fetch('/actual?auto=2', { cache: 'no-store' });
    if (r.ok) {
        const d = await r.json();
        if (d.lat !== null && d.lon !== null) {
            marcador2.setLatLng([d.lat, d.lon]);
            marcador2.setOpacity(1);
            if (seguimientoActivo2) mapa.panTo([d.lat, d.lon]);
        }
        setTexto('lat2', d.lat ?? '-'); setTexto('lon2', d.lon ?? '-');
        setTexto('fecha2', d.fecha ?? '-'); setTexto('hora2', d.hora ?? '-');
    }
    const r2 = await fetch('/recorrido?auto=2&desde=' + ultimoId2, { cache: 'no-store' });
    if (!r2.ok) return;
    const p = await r2.json();
    if (!Array.isArray(p) || p.length === 0) return;
    puntos2 = puntos2.concat(p.map(x => [x.lat, x.lon]));
    linea2.setLatLngs(puntos2);
    ultimoId2 = p[p.length - 1].id;
}
const lineaHistorico = L.polyline([], { color: '#E07B39', weight: 4, dashArray: '6 6' }).addTo(mapa);   // auto 1
const lineaHistorico2 = L.polyline([], { color: '#3B7DDD', weight: 4, dashArray: '6 6' }).addTo(mapa);  // auto 2

function limpiarHistorico() {
    lineaHistorico.setLatLngs([]);
    lineaHistorico2.setLatLngs([]);
}
// Reparte los puntos entre las dos líneas según p.auto
function dibujarHistorico(datos) {
    lineaHistorico.setLatLngs(datos.filter(p => p.auto !== 2).map(p => [p.lat, p.lon]));
    lineaHistorico2.setLatLngs(datos.filter(p => p.auto === 2).map(p => [p.lat, p.lon]));
}
function boundsHistorico() {
    const b = L.latLngBounds([]);
    [lineaHistorico, lineaHistorico2].forEach(l => { if (l.getLatLngs().length) b.extend(l.getBounds()); });
    return b;
}

let ultimoIdCargado = 0;
let puntosRecorrido = [];
let seguimientoActivo = true;   // el mapa sigue al marcador hasta que arrastres el mapa
let seguimientoActivo2 = false; // seguimiento del auto 2 (azul); solo uno de los dos a la vez
let enModoHistorico = false;
let rutasEncontradas = [];

// ---------- En vivo ----------
async function cargarRecorrido() {
    const respuesta = await fetch('/recorrido?desde=' + ultimoIdCargado, { cache: 'no-store' });
    if (!respuesta.ok) return;
    const puntos = await respuesta.json();
    if (!Array.isArray(puntos) || puntos.length === 0) return;

    const nuevosLatLng = puntos.map(p => [p.lat, p.lon]);
    puntosRecorrido = puntosRecorrido.concat(nuevosLatLng);
    linea.setLatLngs(puntosRecorrido);
    ultimoIdCargado = puntos[puntos.length - 1].id;
}

async function actualizarDato() {
    const respuesta = await fetch('/actual', { cache: 'no-store' });
    if (!respuesta.ok) return null;
    const datos = await respuesta.json();

    const lat = Number(datos.lat);
    const lon = Number(datos.lon);

    // 1. Primero el marcador, para que nada lo bloquee
    if (datos.lat !== null && datos.lon !== null && !isNaN(lat) && !isNaN(lon)) {
        marcador.setLatLng([lat, lon]);
        if (seguimientoActivo) {
            mapa.panTo([lat, lon]);
        }
    }

    // 2. Después el panel de texto (tolera elementos que no existan)
    setTexto('lat', datos.lat ?? '-');
    setTexto('lon', datos.lon ?? '-');
    setTexto('fecha', datos.fecha ?? '-');
    setTexto('hora', datos.hora ?? '-');
    setTexto('servidor', datos.servidor ?? '-');

    return datos;
}

let actualizando = false;
async function actualizar() {
    if (actualizando) return;
    actualizando = true;
    try {
        await actualizarDato().catch(e => console.error('actual:', e));
        await cargarRecorrido().catch(e => console.error('recorrido:', e));
        await actualizarAuto2().catch(e => console.error('auto2:', e));
    } finally {
        actualizando = false;
    }
}

// Borra la línea y dibuja solo los puntos que lleguen de ahora en adelante.
async function borrarTrazado() {
    // Espera a que termine la actualización en curso; si no, podría volver a
    // dibujar puntos viejos justo después de borrar.
    while (actualizando) await new Promise(r => setTimeout(r, 50));
    actualizando = true;
    try {
        // Auto 1
        puntosRecorrido = [];
        linea.setLatLngs([]);
        const datos = await actualizarDato();
        ultimoIdCargado = (datos && datos.id) ? datos.id : 0;

        // Auto 2
        puntos2 = [];
        linea2.setLatLngs([]);
        const r2 = await fetch('/actual?auto=2', { cache: 'no-store' });
        if (r2.ok) {
            const d2 = await r2.json();
            ultimoId2 = (d2 && d2.id) ? d2.id : 0;
        }
    } finally {
        actualizando = false;
    }
}

let intervaloId = null;
let pausado = false;

function iniciarIntervalo() {
    clearInterval(intervaloId);
    intervaloId = setInterval(actualizar, 1000);
}

function togglePausa() {
    pausado = !pausado;
    const boton = $('btn-pausa');

    if (pausado) {
        clearInterval(intervaloId);
        if (boton) boton.textContent = 'Reanudar';
    } else {
        iniciarIntervalo();
        if (boton) boton.textContent = 'Pausar';
    }
}

// ---------- Modo histórico ----------
function aFormatoInput(fecha) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}T${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
}

function toggleHistorico() {
    const panel = $('panel-historico');
    const abriendo = !panel.classList.contains('abierto');

    if (abriendo) {
        panel.classList.add('abierto');
        const ahora = new Date();
        const haceUnaHora = new Date(ahora.getTime() - 60 * 60 * 1000);
        $('input-desde').value = aFormatoInput(haceUnaHora);
        $('input-hasta').value = aFormatoInput(ahora);
    } else {
        // Al cerrar el panel se vuelve a en vivo
        volverATiempoReal();
    }
}

async function buscarHistorico() {
    const desde = $('input-desde').value;
    const hasta = $('input-hasta').value;
    const resultadoDiv = $('resultado-historico');

    if (!desde || !hasta) {
        resultadoDiv.textContent = 'Completa ambas fechas.';
        return;
    }

    resultadoDiv.textContent = 'Buscando...';
    setDisplay('contenedor-slider', 'none');

    let rutas;
    try {
        const respuesta = await fetch(`/historico_rutas?desde=${desde}&hasta=${hasta}`, { cache: 'no-store' });
        rutas = await respuesta.json();
    } catch (e) {
        resultadoDiv.textContent = 'Error de conexión con el servidor.';
        return;
    }

    if (rutas.error) {
        resultadoDiv.textContent = 'Error: ' + rutas.error;
        return;
    }
    if (rutas.length === 0) {
        resultadoDiv.textContent = 'No hay datos en ese rango.';
        limpiarHistorico();
        return;
    }

    if (!enModoHistorico) {
        enModoHistorico = true;
        if (!pausado) togglePausa();
    }

    rutasEncontradas = rutas;

    if (rutas.length === 1) {
        const r = rutas[0];
        resultadoDiv.textContent = `Auto ${r[0].auto} · ${r.length} puntos · de ${r[0].hora} a ${r[r.length - 1].hora}`;
        mostrarRuta(r);
        return;
    }

    limpiarHistorico();
    resultadoDiv.innerHTML =
        `<button id="btn-lista-rutas" onclick="toggleListaRutas()"
            style="display:none; width:100%; margin:0 0 6px 0; padding:8px; background:#3B7DD8; color:white;"></button>` +
        `<div id="lista-rutas"><strong>${rutas.length} rutas encontradas:</strong>` +
        rutas.map((r, i) =>
            `<div style="padding:6px 0; border-bottom:1px solid #eee;">
                <button onclick="seleccionarRuta(${i})"
                    style="padding:6px 12px; margin:0 6px 0 0; background:#E07B39; color:white;">
                    Auto ${r[0].auto} · Ruta ${i + 1}
                </button>
                ${r[0].hora.slice(5, 16)} → ${r[r.length - 1].hora.slice(11, 16)} · ${r.length} pts
            </div>`
        ).join('') + `</div>`;
}

function seleccionarRuta(i) {
    const r = rutasEncontradas[i];
    mostrarRuta(r);
    setDisplay('lista-rutas', 'none');
    const b = $('btn-lista-rutas');
    if (b) {
        b.textContent = `Auto ${r[0].auto} · Ruta ${i + 1} · ${r[0].hora.slice(11, 16)} → ${r[r.length - 1].hora.slice(11, 16)} ▼`;
        b.style.display = 'block';
    }
}

function toggleListaRutas() {
    const l = $('lista-rutas');
    if (l) l.style.display = l.style.display === 'none' ? 'block' : 'none';
}

function mostrarRuta(datos) {
    const slider = $('slider-historico');
    const horaSlider = $('hora-slider');
    const dos = datos[0].auto === 2;
    const linea = dos ? lineaHistorico2 : lineaHistorico;
    const mrk = dos ? marcador2 : marcador;
    const s = dos ? '2' : '';

    limpiarHistorico();
    linea.setLatLngs(datos.map(p => [p.lat, p.lon]));
    mapa.fitBounds(linea.getBounds(), { maxZoom: 17 });

    slider.max = datos.length - 1;
    slider.value = datos.length - 1;
    horaSlider.textContent = datos[datos.length - 1].hora;
    setDisplay('contenedor-slider', 'block');

    slider.oninput = function () {
        const idx = parseInt(slider.value);
        const punto = datos[idx];
        horaSlider.textContent = punto.hora;

        linea.setLatLngs(datos.slice(0, idx + 1).map(p => [p.lat, p.lon]));
        mrk.setLatLng([punto.lat, punto.lon]);
        mrk.setOpacity(1);
        mapa.panTo([punto.lat, punto.lon]);

        setTexto('lat' + s, Number(punto.lat).toFixed(5));
        setTexto('lon' + s, Number(punto.lon).toFixed(5));
        setTexto('fecha' + s, punto.hora.split(' ')[0]);
        setTexto('hora' + s, punto.hora.split(' ')[1]);
        setTexto('servidor', '-');
    };
}

function volverATiempoReal() {
    limpiarHistorico();
    setTexto('resultado-historico', '');
    const panel = $('panel-historico');
    if (panel) panel.classList.remove('abierto');
    enModoHistorico = false;

    if (pausado) togglePausa();
    actualizarDato().catch(e => console.error('actual:', e));
}

// ---------- Botón centrar / seguimiento ----------
mapa.on('dragstart', () => {
    if (seguimientoActivo) {
        seguimientoActivo = false;
        const b = $('btn-centrar');
        if (b) b.classList.remove('activo');
    }
    if (seguimientoActivo2) {
        seguimientoActivo2 = false;
        const b2 = $('btn-centrar2');
        if (b2) b2.classList.remove('activo');
    }
});

function centrarUbicacion() {
    seguimientoActivo = !seguimientoActivo;

    if (seguimientoActivo && seguimientoActivo2) {
        seguimientoActivo2 = false;
        const b2 = $('btn-centrar2');
        if (b2) b2.classList.remove('activo');
    }

    const boton = $('btn-centrar');
    if (boton) boton.classList.toggle('activo', seguimientoActivo);

    if (seguimientoActivo) {
        const lat = parseFloat($('lat').textContent);
        const lon = parseFloat($('lon').textContent);
        if (!isNaN(lat) && !isNaN(lon)) {
            mapa.setView([lat, lon], mapa.getZoom());
        }
    }
}

// Igual que centrarUbicacion(), pero para el auto 2 (azul).
function centrarUbicacion2() {
    seguimientoActivo2 = !seguimientoActivo2;

    const boton = $('btn-centrar2');
    if (boton) boton.classList.toggle('activo', seguimientoActivo2);

    if (seguimientoActivo2) {
        // el auto 1 deja de seguirse
        seguimientoActivo = false;
        const b1 = $('btn-centrar');
        if (b1) b1.classList.remove('activo');

        // solo centra si el auto 2 ya tiene una posicion real (opacity 1)
        if (marcador2.options.opacity > 0) {
            mapa.setView(marcador2.getLatLng(), mapa.getZoom());
        }
    }
}

// ---------- Buscar por ubicación ----------
let modosBusquedaUbicacion = false;
let popupBusqueda = null;

function toggleBuscarUbicacion() {
    modosBusquedaUbicacion = !modosBusquedaUbicacion;
    const boton = $('btn-buscar-ubicacion');

    if (modosBusquedaUbicacion) {
        if (boton) { boton.style.background = '#E07B39'; boton.style.color = 'white'; }
        mapa.getContainer().style.cursor = 'crosshair';
        setDisplay('msg-buscar-ubicacion', 'block');
        setDisplay('opciones-buscar', 'block');
    } else {
        if (boton) { boton.style.background = ''; boton.style.color = ''; }
        mapa.getContainer().style.cursor = '';
        setDisplay('msg-buscar-ubicacion', 'none');
        setDisplay('opciones-buscar', 'none');
        const chk = $('chk-historico-total');
        if (chk) chk.checked = false;
        limpiarHistorico();
        if (popupBusqueda) {
            popupBusqueda.remove();
            popupBusqueda = null;
        }
    }
}

mapa.on('click', async function (e) {
    if (!modosBusquedaUbicacion) return;

    const { lat, lng } = e.latlng;
    const respuesta = await fetch(`/buscar_ubicacion?lat=${lat}&lon=${lng}`);
    const datos = await respuesta.json();

    if (popupBusqueda) {
        popupBusqueda.remove();
        popupBusqueda = null;
    }

    if (!Array.isArray(datos) || datos.length === 0) {
        popupBusqueda = L.popup()
            .setLatLng(e.latlng)
            .setContent('El vehículo no pasó por aquí')
            .openOn(mapa);
    } else {
        const lista = datos.map(p =>
            `<div style="padding:4px 0; border-bottom:1px solid #eee;">
                Auto ${p.auto} · ${p.hora}
                <button onclick="verRutaAlrededor(${p.ts_fix}, ${p.auto})"
                    style="margin-left:6px; padding:2px 8px; border:none; border-radius:4px;
                    background:#E07B39; color:white; cursor:pointer; font-size:0.75rem;">
                    Ver ruta
                </button>
            </div>`
        ).join('');

        popupBusqueda = L.popup({ maxHeight: 200 })
            .setLatLng(e.latlng)
            .setContent(`<strong>Pasó por aquí:</strong><br>${lista}`)
            .openOn(mapa);
    }
});

// ---------- Histórico total / desde-hasta ----------
function toggleHistoricoTotal() {
    const activo = $('chk-historico-total').checked;

    if (activo) {
        const chkDesde = $('chk-historico-desde');
        if (chkDesde) chkDesde.checked = false;
        setDisplay('contenedor-desde', 'none');
        limpiarHistorico();
        toggleHistoricoTotalCargar();
    } else {
        limpiarHistorico();
    }
}

async function toggleHistoricoTotalCargar() {
    const respuesta = await fetch('/historico_total');
    const datos = await respuesta.json();
    if (!Array.isArray(datos) || datos.length === 0) return;
    dibujarHistorico(datos);
}

function toggleHistoricoDesde() {
    const activo = $('chk-historico-desde').checked;

    if (activo) {
        const chkTotal = $('chk-historico-total');
        if (chkTotal) chkTotal.checked = false;
        limpiarHistorico();
        setDisplay('contenedor-desde', 'block');

        const ahora = aFormatoInput(new Date());
        $('input-historico-desde').max = ahora;
        $('input-historico-hasta').max = ahora;
        $('input-historico-hasta').value = ahora;
    } else {
        limpiarHistorico();
        setDisplay('contenedor-desde', 'none');
    }
}

async function buscarHistoricoDesde() {
    const desde = $('input-historico-desde').value;
    const hasta = $('input-historico-hasta').value;
    if (!desde || !hasta) return;

    const respuesta = await fetch(`/historico_desde?desde=${desde}&hasta=${hasta}`);
    const datos = await respuesta.json();
    if (!Array.isArray(datos) || datos.length === 0) return;

    dibujarHistorico(datos);
}

async function verRutaAlrededor(ts_fix, auto) {
    const respuesta = await fetch(`/ruta_alrededor?ts_fix=${ts_fix}&auto=${auto}`);
    const datos = await respuesta.json();
    if (!Array.isArray(datos) || datos.length === 0) return;

    dibujarHistorico(datos);
    mapa.fitBounds(boundsHistorico(), { maxZoom: 17 });
}

// ---------- Paneles sobre el mapa ----------
const panelHist = $('panel-historico');
if (panelHist) {
    L.DomEvent.disableClickPropagation(panelHist);
    L.DomEvent.disableScrollPropagation(panelHist);
}

// ---------- Inicio ----------
async function inicializar() {
    try {
        const datos = await actualizarDato();
        if (datos && datos.lat !== null && datos.lon !== null) {
            mapa.setView([Number(datos.lat), Number(datos.lon)], 16);
            ultimoIdCargado = datos.id;
        }
    } catch (e) {
        console.error('inicializar:', e);
    }

    const b = $('btn-centrar');
    if (b) b.classList.toggle('activo', seguimientoActivo);

    iniciarIntervalo();   // siempre arranca, aunque falle la primera lectura
}

window.addEventListener('resize', () => mapa.invalidateSize());
setTimeout(() => mapa.invalidateSize(), 300);

inicializar();