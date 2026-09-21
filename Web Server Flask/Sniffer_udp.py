"""
Sniffer UDP propietario (versión PostgreSQL).

Escucha en un puerto UDP, recibe las tramas de texto que manda la app
(formato: TIPO=GPS,LAT=...,LON=...,TS=...) y las guarda en una base de
datos PostgreSQL remota (el data-server compartido del equipo).

Las credenciales de conexión se leen de variables de entorno, para NO
dejarlas escritas directo en el código que se sube a GitHub.

Uso:
    export PGHOST=44.208.90.129
    export PGDATABASE=coordenadas
    export PGUSER=gpsapp
    export PGPASSWORD=tu_contraseña
    export SERVIDOR_NOMBRE=servidor-carlos      # identifica ESTE servidor

    python3 Sniffer_udp.py
    python3 Sniffer_udp.py --host 0.0.0.0 --port 5000
"""

import argparse
import os
import socket
from datetime import datetime, timezone

import psycopg2

# Datos de conexión: se toman de variables de entorno, con valores por
# defecto solo para pruebas locales rápidas (nunca dejes la contraseña
# real aquí escrita).
PG_HOST = os.environ.get("PGHOST", "localhost")
PG_PORT = int(os.environ.get("PGPORT", "5432"))
PG_DATABASE = os.environ.get("PGDATABASE", "coordenadas")
PG_USER = os.environ.get("PGUSER", "gpsapp")
PG_PASSWORD = os.environ.get("PGPASSWORD", "")

# Identifica cuál de los servidores del equipo procesó cada dato.
SERVIDOR_NOMBRE = os.environ.get("SERVIDOR_NOMBRE", "servidor-sin-nombre")


def conectar_bd():
    """Abre una conexión nueva a PostgreSQL. Se llama en cada inserción,
    igual que hacíamos con sqlite3.connect(), para no dejar conexiones
    colgadas si el sniffer corre por días."""
    return psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        dbname=PG_DATABASE,
        user=PG_USER,
        password=PG_PASSWORD,
        sslmode="require",  # la conexión sale por internet, siempre cifrada
        connect_timeout=5,
    )


def guardar_en_bd(trama: dict, origen_ip: str, recibido_en: str) -> None:
    """
    Inserta una coordenada ya decodificada en PostgreSQL, incluyendo de
    qué servidor del equipo vino (SERVIDOR_NOMBRE).
    """
    conexion = conectar_bd()
    try:
        with conexion.cursor() as cursor:
            cursor.execute(
                "INSERT INTO coordenadas "
                "(lat, lon, ts_fix, origen_ip, recibido_en, servidor_nombre) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (trama["lat"], trama["lon"], trama["ts"], origen_ip, recibido_en, SERVIDOR_NOMBRE),
            )
        conexion.commit()
    finally:
        conexion.close()


def parsear_trama(texto: str) -> dict | None:
    """
    Convierte una trama tipo:
        TIPO=GPS,LAT=11.023383,LON=-74.8464518,TS=1787714213131
    en un diccionario:
        {"tipo": "GPS", "lat": 11.023383, "lon": -74.8464518, "ts": 1787714213131}

    Devuelve None si la trama no tiene el formato esperado, para que el
    sniffer pueda ignorar paquetes basura o corruptos sin caerse.
    """
    campos = {}
    try:
        for par in texto.strip().split(","):
            clave, valor = par.split("=", 1)
            campos[clave.strip().upper()] = valor.strip()

        if campos.get("TIPO") != "GPS":
            return None

        return {
            "tipo": campos["TIPO"],
            "lat": float(campos["LAT"]),
            "lon": float(campos["LON"]),
            "ts": int(campos["TS"]),
        }
    except (KeyError, ValueError):
        return None


def iniciar_sniffer(host: str, port: int) -> None:
    # Prueba la conexión a la base de datos ANTES de empezar a escuchar,
    # para fallar rápido y con un mensaje claro si algo está mal
    # configurado (credenciales, Security Group, pg_hba.conf, etc.).
    try:
        conexion_prueba = conectar_bd()
        conexion_prueba.close()
        print(f"[sniffer] conexión a PostgreSQL OK ({PG_HOST}:{PG_PORT}/{PG_DATABASE})")
    except Exception as error:
        print(f"[sniffer] ERROR: no se pudo conectar a PostgreSQL -> {error}")
        print("[sniffer] revisa PGHOST/PGUSER/PGPASSWORD, el Security Group y pg_hba.conf")
        return

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((host, port))
    print(f"[sniffer] escuchando UDP en {host}:{port} ... (Ctrl+C para salir)")
    print(f"[sniffer] identificándose como: {SERVIDOR_NOMBRE}")

    ultimo_ts = None

    while True:
        try:
            datos, direccion = sock.recvfrom(1024)
        except KeyboardInterrupt:
            print("\n[sniffer] detenido por el usuario")
            break

        recibido_en = datetime.now(timezone.utc).isoformat()

        try:
            texto = datos.decode("utf-8")
        except UnicodeDecodeError:
            print(f"[sniffer] paquete no legible desde {direccion}, descartado")
            continue

        trama = parsear_trama(texto)

        if trama is None:
            print(f"[sniffer] trama inválida desde {direccion}: {texto!r}")
            continue

        fuera_de_orden = ultimo_ts is not None and trama["ts"] < ultimo_ts
        ultimo_ts = trama["ts"]

        print(
            f"[sniffer] {recibido_en} | origen={direccion[0]}:{direccion[1]} "
            f"| lat={trama['lat']} lon={trama['lon']} ts={trama['ts']}"
            + (" | ¡FUERA DE ORDEN!" if fuera_de_orden else "")
        )

        try:
            guardar_en_bd(trama, direccion[0], recibido_en)
        except Exception as error:
            # Si la base de datos falla momentáneamente (red, reinicio del
            # data-server, etc.), el sniffer sigue vivo en vez de caerse.
            print(f"[sniffer] ERROR al guardar en la base de datos: {error}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sniffer UDP propietario para tramas GPS (PostgreSQL)")
    parser.add_argument("--host", default="0.0.0.0", help="IP donde escuchar (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=5000, help="Puerto UDP a escuchar (default: 5000)")
    args = parser.parse_args()

    iniciar_sniffer(args.host, args.port)
