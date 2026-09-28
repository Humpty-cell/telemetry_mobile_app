const mapa = L.map('mapa', { zoomControl: true }).setView([10.9878, -74.7889], 15);

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
    await cargarRecorrido();
    await actualizarDato();
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

async function buscarHistorico() {
    const desde = document.getElementById('input-desde').value;
    const hasta = document.getElementById('input-hasta').value;
    const resultadoDiv = document.getElementById('resultado-historico');
    const contenedorSlider = document.getElementById('contenedor-slider');
    const slider = document.getElementById('slider-historico');
    const horaSlider = document.getElementById('hora-slider');

    if (!desde || !hasta) {
        resultadoDiv.textContent = 'Completa ambas fechas.';
        return;
    }

    resultadoDiv.textContent = 'Buscando...';
    contenedorSlider.style.display = 'none';

    const respuesta = await fetch(`/historico?desde=${desde}&hasta=${hasta}`);
    const datos = await respuesta.json();

    if (datos.error) {
        resultadoDiv.textContent = 'Error: ' + datos.error;
        return;
    }

    if (datos.length === 0) {
        resultadoDiv.textContent = 'No hay datos en ese rango.';
        lineaHistorico.setLatLngs([]);
        return;
    }

    if (!enModoHistorico) {
        enModoHistorico = true;
        if (!pausado) togglePausa();
    }

    // Mostrar recorrido completo inicialmente
    const puntos = datos.map(p => [p.lat, p.lon]);
    lineaHistorico.setLatLngs(puntos);
    mapa.fitBounds(lineaHistorico.getBounds(), { maxZoom: 17 });

    resultadoDiv.textContent = `${datos.length} puntos encontrados · ` +
        `de ${datos[0].hora} a ${datos[datos.length - 1].hora}`;

    // Configurar slider
    slider.max = datos.length - 1;
    slider.value = datos.length - 1;
    contenedorSlider.style.display = 'block';

    slider.oninput = function() {
        const idx = parseInt(this.value);
        const punto = datos[idx];

        // Dibujar recorrido progresivo
        const puntosHasta = datos.slice(0, idx + 1).map(p => [p.lat, p.lon]);
        lineaHistorico.setLatLngs(puntosHasta);

        // Mover marcador
        marcador.setLatLng([punto.lat, punto.lon]);
        mapa.panTo([punto.lat, punto.lon]);

        // Actualizar panel izquierdo
        document.getElementById('lat').textContent = punto.lat;
        document.getElementById('lon').textContent = punto.lon;
        document.getElementById('fecha').textContent = punto.hora.split(' ')[0];
	document.getElementById('hora').textContent = punto.hora.split(' ')[1];
        document.getElementById('servidor').textContent = punto.servidor ?? '-';

        // Mostrar hora bajo el slider
        horaSlider.textContent = punto.hora;
    };
}

function volverATiempoReal() {
    lineaHistorico.setLatLngs([]);
    document.getElementById('resultado-historico').textContent = '';
    document.getElementById('panel-historico').classList.remove('abierto');
    enModoHistorico = false;

    if (pausado) togglePausa();
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

let autocentrado = true;

function toggleAutocentrar() {
    autocentrado = !autocentrado;
    const boton = document.getElementById('btn-autocentrar');
    if (autocentrado) {
        boton.classList.add('activo');
    } else {
        boton.classList.remove('activo');
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
        const lista = datos.map(p => `<div>📍 ${p.hora}</div>`).join('');
        popupBusqueda = L.popup({ maxHeight: 200 })
            .setLatLng(e.latlng)
            .setContent(`<strong>Pasó por aquí:</strong><br>${lista}`)
            .openOn(mapa);
    }
});

async function toggleHistoricoTotal() {
    const activo = document.getElementById('chk-historico-total').checked;

    if (!activo) {
        lineaHistorico.setLatLngs([]);
        return;
    }

    const respuesta = await fetch('/historico_total');
    const datos = await respuesta.json();

    if (datos.length === 0) return;

    const puntos = datos.map(p => [p.lat, p.lon]);
    lineaHistorico.setLatLngs(puntos);
}

function toggleHistoricoDesde() {
    const activo = document.getElementById('chk-historico-desde').checked;
    document.getElementById('contenedor-desde').style.display = activo ? 'block' : 'none';
    if (!activo) lineaHistorico.setLatLngs([]);
}

async function buscarHistoricoDesde() {
    const desde = document.getElementById('input-historico-desde').value;
    if (!desde) return;

    const respuesta = await fetch(`/historico_desde?desde=${desde}`);
    const datos = await respuesta.json();

    if (datos.length === 0) return;

    const puntos = datos.map(p => [p.lat, p.lon]);
    lineaHistorico.setLatLngs(puntos);
}

inicializar();
