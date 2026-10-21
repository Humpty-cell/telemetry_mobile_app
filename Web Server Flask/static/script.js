const mapa = L.map('mapa', { zoomControl: false }).setView([10.9878, -74.7889], 15);
L.control.zoom({ position: 'bottomleft' }).addTo(mapa);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(mapa);

const marcador = L.marker([10.9878, -74.7889]).addTo(mapa);
const linea = L.polyline([], { color: '#1D9E75', weight: 4 }).addTo(mapa);

let ultimoIdCargado = 0;
let puntosRecorrido = [];
let seguimientoActivo = false;


async function cargarRecorrido() {
    const respuesta = await fetch('/recorrido?desde=' + ultimoIdCargado);
    const puntos = await respuesta.json();

    if (puntos.length === 0) return;

    const nuevosLatLng = puntos.map(p => [p.lat, p.lon]);
    puntosRecorrido = puntosRecorrido.concat(nuevosLatLng);
    linea.setLatLngs(puntosRecorrido);
    ultimoIdCargado = puntos[puntos.length - 1].id;
}

async function actualizarDato() {
    const respuesta = await fetch('/actual');
    const datos = await respuesta.json();

    document.getElementById('lat').textContent = datos.lat ?? '-';
    document.getElementById('lon').textContent = datos.lon ?? '-';
    document.getElementById('fecha').textContent = datos.fecha;
    document.getElementById('hora').textContent = datos.hora;
    document.getElementById('servidor').textContent = datos.servidor;

if (datos.lat !== null && datos.lon !== null) {
    marcador.setLatLng([datos.lat, datos.lon]);
    if (autocentrado) {
        mapa.panTo([datos.lat, datos.lon]);
    }
}


    return datos;
}

async function actualizar() {
    try { await cargarRecorrido(); } catch (e) { console.error('recorrido', e); }
    try { await actualizarDato(); } catch (e) { console.error('dato', e); }
}
// Borra la línea del mapa y le dice a la página que, de ahora en
// adelante, solo dibuje los puntos que lleguen DESPUÉS de este
// momento — sin esto, el próximo refresco automático volvería a
// traer todo el historial viejo y la línea reaparecería sola.
async function borrarTrazado() {
    puntosRecorrido = [];
    linea.setLatLngs([]);

    const datos = await actualizarDato();
    ultimoIdCargado = (datos && datos.id) ? datos.id : 0;
}

let intervaloId = null;
let pausado = false;

function iniciarIntervalo() {
    intervaloId = setInterval(actualizar, 1000);
}

function togglePausa() {
    pausado = !pausado;
    const boton = document.getElementById('btn-pausa');

    if (pausado) {
        clearInterval(intervaloId);
        boton.textContent = 'Reanudar';
    } else {
        iniciarIntervalo();
        boton.textContent = 'Pausar';
    }
}



// --- Modo histórico ---
const lineaHistorico = L.polyline([], { color: '#E07B39', weight: 4, dashArray: '6 6' }).addTo(mapa);
let enModoHistorico = false;

function toggleHistorico() {
    const panel = document.getElementById('panel-historico');
    panel.classList.toggle('abierto');

    if (panel.classList.contains('abierto')) {
        // Valores por defecto útiles: desde hace 1 hora hasta
        // ahora, para que el usuario no escriba fechas desde cero.
        const ahora = new Date();
        const haceUnaHora = new Date(ahora.getTime() - 60 * 60 * 1000);
        document.getElementById('input-desde').value = aFormatoInput(haceUnaHora);
        document.getElementById('input-hasta').value = aFormatoInput(ahora);
    }
}

function aFormatoInput(fecha) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}T${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
}

let rutasEncontradas = [];

async function buscarHistorico() {
    const desde = document.getElementById('input-desde').value;
    const hasta = document.getElementById('input-hasta').value;
    const resultadoDiv = document.getElementById('resultado-historico');
    const contenedorSlider = document.getElementById('contenedor-slider');

    if (!desde || !hasta) {
        resultadoDiv.textContent = 'Completa ambas fechas.';
        return;
    }

    resultadoDiv.textContent = 'Buscando...';
    contenedorSlider.style.display = 'none';

    const respuesta = await fetch(`/historico_rutas?desde=${desde}&hasta=${hasta}`);
    const rutas = await respuesta.json();

    if (rutas.error) {
        resultadoDiv.textContent = 'Error: ' + rutas.error;
        return;
    }
    if (rutas.length === 0) {
        resultadoDiv.textContent = 'No hay datos en ese rango.';
        lineaHistorico.setLatLngs([]);
        return;
    }

    if (!enModoHistorico) {
        enModoHistorico = true;
        if (!pausado) togglePausa();
    }

    rutasEncontradas = rutas;

    if (rutas.length === 1) {
        const r = rutas[0];
        resultadoDiv.textContent = `${r.length} puntos · de ${r[0].hora} a ${r[r.length - 1].hora}`;
        mostrarRuta(r);
        return;
    }

      lineaHistorico.setLatLngs([]);
    resultadoDiv.innerHTML =
        `<button id="btn-lista-rutas" onclick="toggleListaRutas()"
            style="display:none; width:100%; margin:0 0 6px 0; padding:8px; background:#3B7DD8; color:white;"></button>` +
        `<div id="lista-rutas"><strong>${rutas.length} rutas encontradas:</strong>` +
        rutas.map((r, i) =>
            `<div style="padding:6px 0; border-bottom:1px solid #eee;">
                <button onclick="seleccionarRuta(${i})"
                    style="padding:6px 12px; margin:0 6px 0 0; background:#E07B39; color:white;">
                    Ruta ${i + 1}
                </button>
                ${r[0].hora.slice(5, 16)} → ${r[r.length - 1].hora.slice(11, 16)} · ${r.length} pts
            </div>`
        ).join('') + `</div>`;
}


function seleccionarRuta(i) {
    const r = rutasEncontradas[i];
    mostrarRuta(r);
    document.getElementById('lista-rutas').style.display = 'none';
    const b = document.getElementById('btn-lista-rutas');
    b.textContent = `Ruta ${i + 1} · ${r[0].hora.slice(11, 16)} → ${r[r.length - 1].hora.slice(11, 16)} ▼`;
    b.style.display = 'block';
}

function toggleListaRutas() {
    const l = document.getElementById('lista-rutas');
    l.style.display = l.style.display === 'none' ? 'block' : 'none';
}





function mostrarRuta(datos) {
    const contenedorSlider = document.getElementById('contenedor-slider');
    const slider = document.getElementById('slider-historico');
    const horaSlider = document.getElementById('hora-slider');

    lineaHistorico.setLatLngs(datos.map(p => [p.lat, p.lon]));
    mapa.fitBounds(lineaHistorico.getBounds(), { maxZoom: 17 });

    slider.max = datos.length - 1;
    slider.value = datos.length - 1;
    horaSlider.textContent = datos[datos.length - 1].hora;
    contenedorSlider.style.display = 'block';

    slider.oninput = function () {
        const punto = datos[parseInt(slider.value)];
        horaSlider.textContent = punto.hora;   // hora del punto (ts_fix)

        try {
            const idx = parseInt(slider.value);
            lineaHistorico.setLatLngs(datos.slice(0, idx + 1).map(p => [p.lat, p.lon]));
            marcador.setLatLng([punto.lat, punto.lon]);
            mapa.panTo([punto.lat, punto.lon]);
            document.getElementById('lat').textContent = Number(punto.lat).toFixed(5);
            document.getElementById('lon').textContent = Number(punto.lon).toFixed(5);
            document.getElementById('fecha').textContent = punto.hora.split(' ')[0];
            document.getElementById('hora').textContent = punto.hora.split(' ')[1];
            document.getElementById('servidor').textContent = '-';
        } catch (e) {
            console.error(e);
        }
    };
    }

function volverATiempoReal() {
    lineaHistorico.setLatLngs([]);
    document.getElementById('resultado-historico').textContent = '';
    document.getElementById('panel-historico').classList.remove('abierto');
    enModoHistorico = false;

    if (pausado) togglePausa();
    actualizarDato(); 
}

// Al abrir o recargar la página, NO cargamos el historial viejo:
// le preguntamos al servidor cuál es el último dato AHORA MISMO,
// y empezamos a dibujar solo lo que llegue de ahí en adelante.
async function inicializar() {
    const datos = await actualizarDato();

    if (datos && datos.lat !== null && datos.lon !== null) {
        mapa.setView([datos.lat, datos.lon], 16);
        ultimoIdCargado = datos.id;
    }

    iniciarIntervalo();
}

window.addEventListener('resize', () => mapa.invalidateSize());
setTimeout(() => mapa.invalidateSize(), 300);

mapa.on('dragstart', () => {
    if (seguimientoActivo) {
        seguimientoActivo = false;
        document.getElementById('btn-centrar').classList.remove('activo');
    }
});

function centrarUbicacion() {
    seguimientoActivo = !seguimientoActivo;

    const boton = document.getElementById('btn-centrar');
    boton.classList.toggle('activo', seguimientoActivo);

    if (seguimientoActivo) {
        const lat = parseFloat(document.getElementById('lat').textContent);
        const lon = parseFloat(document.getElementById('lon').textContent);
        if (!isNaN(lat) && !isNaN(lon)) {
            mapa.setView([lat, lon], mapa.getZoom());
        }
    }
}



let modosBusquedaUbicacion = false;
let popupBusqueda = null;

function toggleBuscarUbicacion() {
    modosBusquedaUbicacion = !modosBusquedaUbicacion;
    const boton = document.getElementById('btn-buscar-ubicacion');
    const msg = document.getElementById('msg-buscar-ubicacion');

    if (modosBusquedaUbicacion) {
        boton.style.background = '#E07B39';
        boton.style.color = 'white';
        mapa.getContainer().style.cursor = 'crosshair';
        msg.style.display = 'block';
        document.getElementById('opciones-buscar').style.display = 'block';
    } else {
        boton.style.background = '';
        boton.style.color = '';
        mapa.getContainer().style.cursor = '';
        msg.style.display = 'none';
        document.getElementById('opciones-buscar').style.display = 'none';
        document.getElementById('chk-historico-total').checked = false;
        lineaHistorico.setLatLngs([]);
        if (popupBusqueda) {
            popupBusqueda.remove();
            popupBusqueda = null;
        }
    }
}

mapa.on('click', async function(e) {
    if (!modosBusquedaUbicacion) return;

    const { lat, lng } = e.latlng;
    const respuesta = await fetch(`/buscar_ubicacion?lat=${lat}&lon=${lng}`);
    const datos = await respuesta.json();

    if (popupBusqueda) {
        popupBusqueda.remove();
        popupBusqueda = null;
    }

    if (datos.length === 0) {
        popupBusqueda = L.popup()
            .setLatLng(e.latlng)
            .setContent('El vehículo no pasó por aquí')
            .openOn(mapa);
    } else {
        const lista = datos.map(p => 
            `<div style="padding:4px 0; border-bottom:1px solid #eee;">
                📍 ${p.hora}
                <button onclick="verRutaAlrededor(${p.ts_fix})" 
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

function toggleHistoricoTotal() {
    const activo = document.getElementById('chk-historico-total').checked;
    
    if (activo) {
        document.getElementById('chk-historico-desde').checked = false;
        document.getElementById('contenedor-desde').style.display = 'none';
        lineaHistorico.setLatLngs([]);
        toggleHistoricoTotalCargar();
    } else {
        lineaHistorico.setLatLngs([]);
    }
}

async function toggleHistoricoTotalCargar() {
    const respuesta = await fetch('/historico_total');
    const datos = await respuesta.json();
    if (datos.length === 0) return;
    const puntos = datos.map(p => [p.lat, p.lon]);
    lineaHistorico.setLatLngs(puntos);
}

function toggleHistoricoDesde() {
    const activo = document.getElementById('chk-historico-desde').checked;
    
    if (activo) {
        document.getElementById('chk-historico-total').checked = false;
        lineaHistorico.setLatLngs([]);
        document.getElementById('contenedor-desde').style.display = 'block';

        // Limitar el máximo al momento actual
        const ahora = aFormatoInput(new Date());
        document.getElementById('input-historico-desde').max = ahora;
        document.getElementById('input-historico-hasta').max = ahora;
        document.getElementById('input-historico-hasta').value = ahora;
    } else {
        lineaHistorico.setLatLngs([]);
        document.getElementById('contenedor-desde').style.display = 'none';
    }
}

async function buscarHistoricoDesde() {
    const desde = document.getElementById('input-historico-desde').value;
    const hasta = document.getElementById('input-historico-hasta').value;
    if (!desde || !hasta) return;

    const respuesta = await fetch(`/historico_desde?desde=${desde}&hasta=${hasta}`);
    const datos = await respuesta.json();

    if (datos.length === 0) return;

    const puntos = datos.map(p => [p.lat, p.lon]);
    lineaHistorico.setLatLngs(puntos);
}

async function verRutaAlrededor(ts_fix) {
    const respuesta = await fetch(`/ruta_alrededor?ts_fix=${ts_fix}`);
    const datos = await respuesta.json();

    if (datos.length === 0) return;

    const puntos = datos.map(p => [p.lat, p.lon]);
    lineaHistorico.setLatLngs(puntos);
    mapa.fitBounds(lineaHistorico.getBounds(), { maxZoom: 17 });
}

const panelHist = document.getElementById('panel-historico');
L.DomEvent.disableClickPropagation(panelHist);
L.DomEvent.disableScrollPropagation(panelHist);

inicializar();
