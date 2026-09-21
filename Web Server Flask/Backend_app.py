"""
Backend Flask (versión PostgreSQL + mapa a pantalla completa) con
botón para borrar y reiniciar el trazado del recorrido bajo demanda,
mientras el dibujo automático del recorrido sigue activo en segundo
plano cada 1 segundo.
"""

import os
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg2
from flask import Flask, jsonify, request

PG_HOST = os.environ.get("PGHOST", "localhost")
PG_PORT = int(os.environ.get("PGPORT", "5432"))
PG_DATABASE = os.environ.get("PGDATABASE", "coordenadas")
PG_USER = os.environ.get("PGUSER", "gpsapp")
PG_PASSWORD = os.environ.get("PGPASSWORD", "")

ZONA_LOCAL = ZoneInfo("America/Bogota")

app = Flask(__name__)


def conectar_bd():
    return psycopg2.connect(
        host=PG_HOST, dbname=PG_DATABASE, user=PG_USER,
        password=PG_PASSWORD, sslmode="require", connect_timeout=5,
    )


def obtener_ultima_coordenada() -> dict | None:
    conexion = conectar_bd()
    try:
        with conexion.cursor() as cursor:
            cursor.execute(
                "SELECT id, lat, lon, ts_fix, servidor_nombre FROM coordenadas "
                "ORDER BY id DESC LIMIT 1"
            )
            fila = cursor.fetchone()
    finally:
        conexion.close()

    if fila is None:
        return None

    id_, lat, lon, ts_fix, servidor_nombre = fila
    momento_local = datetime.fromtimestamp(ts_fix / 1000, tz=ZONA_LOCAL)

    return {
        "id": id_,
        "lat": lat,
        "lon": lon,
        "fecha": momento_local.strftime("%Y-%m-%d"),
        "hora": momento_local.strftime("%H:%M:%S"),
        "servidor": servidor_nombre,
    }


def obtener_recorrido(desde_id: int = 0, limite: int = 2000) -> list[dict]:
    conexion = conectar_bd()
    try:
        with conexion.cursor() as cursor:
            cursor.execute(
                "SELECT id, lat, lon FROM coordenadas "
                "WHERE id > %s ORDER BY id ASC LIMIT %s",
                (desde_id, limite),
            )
            filas = cursor.fetchall()
    finally:
        conexion.close()

    return [{"id": f[0], "lat": f[1], "lon": f[2]} for f in filas]


@app.route("/actual")
def actual():
    try:
        datos = obtener_ultima_coordenada()
    except Exception as error:
        return jsonify({"error": f"No se pudo consultar la base de datos: {error}"}), 500

    if datos is None:
        return jsonify({"id": 0, "lat": None, "lon": None, "fecha": "-", "hora": "-", "servidor": "-"})
    return jsonify(datos)


@app.route("/recorrido")
def recorrido():
    desde_id = request.args.get("desde", default=0, type=int)
    try:
        puntos = obtener_recorrido(desde_id)
    except Exception as error:
        return jsonify({"error": f"No se pudo consultar la base de datos: {error}"}), 500
    return jsonify(puntos)


@app.route("/")
def pagina_principal():
    html = """
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Recorrido en tiempo real</title>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
            html, body {
                margin: 0;
                padding: 0;
                height: 100%;
                font-family: -apple-system, "Segoe UI", Roboto, monospace;
                overflow: hidden;
            }

            #mapa {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                z-index: 1;
            }

            #panel {
                position: fixed;
                top: 16px;
                left: 16px;
                z-index: 1000;
                background: rgba(255, 255, 255, 0.94);
                backdrop-filter: blur(4px);
                padding: 14px 18px;
                border-radius: 12px;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
                max-width: 240px;
                font-size: 0.9rem;
                line-height: 1.5;
            }

            #panel h1 {
                font-size: 1rem;
                margin: 0 0 8px 0;
            }

            #panel p {
                margin: 2px 0;
                color: #222;
            }

            #panel button {
                margin-top: 10px;
                margin-right: 6px;
                padding: 6px 14px;
                cursor: pointer;
                border: none;
                border-radius: 6px;
                font-weight: bold;
            }

            #btn-pausa {
                background: #1D9E75;
                color: white;
            }

            #btn-borrar {
                background: #D85A30;
                color: white;
            }

            @media (max-width: 480px) {
                #panel {
                    max-width: calc(100vw - 64px);
                    font-size: 0.85rem;
                }
            }
        </style>
    </head>
    <body>
        <div id="mapa"></div>

        <div id="panel">
            <h1>Recorrido del vehículo</h1>
            <p>Lat: <span id="lat">-</span></p>
            <p>Long: <span id="lon">-</span></p>
            <p>Fecha: <span id="fecha">-</span></p>
            <p>Hora: <span id="hora">-</span></p>
            <p>Servidor: <span id="servidor">-</span></p>
            <button id="btn-pausa" onclick="togglePausa()">Pausar</button>
            <button id="btn-borrar" onclick="borrarTrazado()">Borrar trazado</button>
        </div>

        <script>
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
        </script>
    </body>
    </html>
    """
    return html


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
