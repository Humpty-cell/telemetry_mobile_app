"""
db.py — Toda la lógica de acceso a la base de datos PostgreSQL.

Separado de Backend_app.py a propósito: si necesitas cambiar una
consulta SQL o cómo se conecta a la base de datos, este es el ÚNICO
archivo que necesitas tocar. Backend_app.py no sabe nada de SQL, solo
llama a las funciones de aquí.
"""

import os
from datetime import datetime
from zoneinfo import ZoneInfo

import psycopg2

PG_HOST = os.environ.get("PGHOST", "localhost")
PG_PORT = int(os.environ.get("PGPORT", "5432"))
PG_DATABASE = os.environ.get("PGDATABASE", "coordenadas")
PG_USER = os.environ.get("PGUSER", "gpsapp")
PG_PASSWORD = os.environ.get("PGPASSWORD", "")

ZONA_LOCAL = ZoneInfo("America/Bogota")  # UTC-5, sin horario de verano


def conectar_bd():
    """Abre una conexión nueva a PostgreSQL. Se llama una vez por
    consulta, igual que veníamos haciendo, para no dejar conexiones
    colgadas si el servidor corre por días."""
    return psycopg2.connect(
        host=PG_HOST, port=PG_PORT, dbname=PG_DATABASE, user=PG_USER,
        password=PG_PASSWORD, sslmode="require", connect_timeout=5,
    )


def obtener_ultima_coordenada() -> dict | None:
    """Consulta la fila más reciente de toda la tabla."""
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
    """Devuelve los puntos con id mayor a `desde_id`, en orden
    cronológico — usado para dibujar el recorrido en vivo trayendo
    solo lo NUEVO en cada consulta, no todo el historial cada vez."""
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


def obtener_historico(desde_ms: int, hasta_ms: int, limite: int = 5000) -> list[dict]:
    """Devuelve los puntos cuyo ts_fix (timestamp GPS, en milisegundos
    UTC) cae dentro del rango [desde_ms, hasta_ms], en orden
    cronológico — usado por la búsqueda de histórico por fecha/hora."""
    conexion = conectar_bd()
    try:
        with conexion.cursor() as cursor:
            cursor.execute(
                "SELECT lat, lon, ts_fix FROM coordenadas "
                "WHERE ts_fix BETWEEN %s AND %s "
                "ORDER BY ts_fix ASC LIMIT %s",
                (desde_ms, hasta_ms, limite),
            )
            filas = cursor.fetchall()
    finally:
        conexion.close()

    puntos = []
    for lat, lon, ts_fix in filas:
        momento_local = datetime.fromtimestamp(ts_fix / 1000, tz=ZONA_LOCAL)
        puntos.append({
            "lat": lat,
            "lon": lon,
            "hora": momento_local.strftime("%Y-%m-%d %H:%M:%S"),
        })
    return puntos

def buscar_por_ubicacion(lat_click: float, lon_click: float, radio_metros: float = 100) -> list[dict]:
    """Busca puntos dentro de un radio en metros usando la fórmula de Haversine en SQL."""
    conexion = conectar_bd()
    try:
        with conexion.cursor() as cursor:
            cursor.execute(
                """
                SELECT lat, lon, ts_fix
                FROM coordenadas
                WHERE (
                    6371000 * acos(
                        cos(radians(%s)) * cos(radians(lat)) *
                        cos(radians(lon) - radians(%s)) +
                        sin(radians(%s)) * sin(radians(lat))
                    )
                ) <= %s
                ORDER BY ts_fix ASC
                """,
                (lat_click, lon_click, lat_click, radio_metros),
            )
            filas = cursor.fetchall()
    finally:
        conexion.close()

    puntos = []
    for lat, lon, ts_fix in filas:
        momento_local = datetime.fromtimestamp(ts_fix / 1000, tz=ZONA_LOCAL)
        puntos.append({
            "lat": lat,
            "lon": lon,
            "ts_fix": ts_fix,
            "hora": momento_local.strftime("%Y-%m-%d %H:%M:%S"),
        })
    return puntos

def obtener_historico_total(limite: int = 10000) -> list[dict]:
    """Devuelve todos los puntos del historial ordenados cronológicamente."""
    conexion = conectar_bd()
    try:
        with conexion.cursor() as cursor:
            cursor.execute(
                "SELECT lat, lon, ts_fix FROM coordenadas ORDER BY ts_fix ASC LIMIT %s",
                (limite,),
            )
            filas = cursor.fetchall()
    finally:
        conexion.close()

    puntos = []
    for lat, lon, ts_fix in filas:
        momento_local = datetime.fromtimestamp(ts_fix / 1000, tz=ZONA_LOCAL)
        puntos.append({"lat": lat, "lon": lon, "hora": momento_local.strftime("%Y-%m-%d %H:%M:%S")})
    return puntos

def obtener_historico_desde(desde_ms: int, hasta_ms: int, limite: int = 10000) -> list[dict]:
    """Devuelve todos los puntos entre desde_ms y hasta_ms."""
    conexion = conectar_bd()
    try:
        with conexion.cursor() as cursor:
            cursor.execute(
                "SELECT lat, lon, ts_fix FROM coordenadas WHERE ts_fix BETWEEN %s AND %s ORDER BY ts_fix ASC LIMIT %s",
                (desde_ms, hasta_ms, limite),
            )
            filas = cursor.fetchall()
    finally:
        conexion.close()

    puntos = []
    for lat, lon, ts_fix in filas:
        momento_local = datetime.fromtimestamp(ts_fix / 1000, tz=ZONA_LOCAL)
        puntos.append({"lat": lat, "lon": lon, "hora": momento_local.strftime("%Y-%m-%d %H:%M:%S")})
    return puntos

def obtener_ruta_alrededor(ts_fix_ms: int, minutos: int = 30) -> list[dict]:
    """Devuelve puntos desde 30 min antes hasta 30 min después de un timestamp."""
    margen_ms = minutos * 60 * 1000
    desde_ms = ts_fix_ms - margen_ms
    hasta_ms = ts_fix_ms + margen_ms

    conexion = conectar_bd()
    try:
        with conexion.cursor() as cursor:
            cursor.execute(
                "SELECT lat, lon, ts_fix FROM coordenadas "
                "WHERE ts_fix BETWEEN %s AND %s ORDER BY ts_fix ASC",
                (desde_ms, hasta_ms),
            )
            filas = cursor.fetchall()
    finally:
        conexion.close()

    puntos = []
    for lat, lon, ts_fix in filas:
        momento_local = datetime.fromtimestamp(ts_fix / 1000, tz=ZONA_LOCAL)
        puntos.append({"lat": lat, "lon": lon, "ts_fix": ts_fix, "hora": momento_local.strftime("%Y-%m-%d %H:%M:%S")})
    return puntos