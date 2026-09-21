const mapa = L.map('mapa', { zoomControl: true }).setView([10.9878, -74.7889], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(mapa);

const marcador = L.marker([10.9878, -74.7889]).addTo(mapa);
const linea = L.polyline([], { color: '#1D9E75', weight: 4 }).addTo(mapa);

let ultimoIdCargado = 0;
let puntosRecorrido = [];

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

    if (!desde || !hasta) {
        resultadoDiv.textContent = 'Completa ambas fechas.';
        return;
    }

    resultadoDiv.textContent = 'Buscando...';

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

    // Entrar a modo histórico: pausamos el auto-refresco en vivo
    // para que las dos rutas no se mezclen visualmente.
    if (!enModoHistorico) {
        enModoHistorico = true;
        if (!pausado) togglePausa();
    }

    const puntos = datos.map(p => [p.lat, p.lon]);
    lineaHistorico.setLatLngs(puntos);
    mapa.fitBounds(lineaHistorico.getBounds(), { maxZoom: 17 });

    resultadoDiv.textContent = `${datos.length} puntos encontrados · ` +
        `de ${datos[0].hora} a ${datos[datos.length - 1].hora}`;
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

inicializar();
