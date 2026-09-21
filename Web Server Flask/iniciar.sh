#!/bin/bash
# Script de arranque del web-server (versión PostgreSQL).
#
# Este script SÍ se puede compartir/subir a GitHub con seguridad: no
# tiene ninguna contraseña escrita adentro. Cada persona que lo use
# debe tener, en la misma carpeta, un archivo llamado config.env con
# sus propias credenciales (ver config.env.example como plantilla).
#
# Uso (parado en la carpeta "Web Server Flask"):
#   cp config.env.example config.env   (solo la primera vez)
#   nano config.env                     (completa tus credenciales reales)
#   chmod +x iniciar.sh
#   ./iniciar.sh

if [ ! -f config.env ]; then
    echo "[iniciar.sh] ERROR: no existe config.env en esta carpeta."
    echo "[iniciar.sh] Copia config.env.example a config.env y completa tus credenciales:"
    echo "[iniciar.sh]     cp config.env.example config.env"
    echo "[iniciar.sh]     nano config.env"
    exit 1
fi

echo "[iniciar.sh] cargando credenciales desde config.env..."
set -a               # exporta automáticamente todo lo que se cargue
source config.env
set +a

echo "[iniciar.sh] deteniendo procesos anteriores (si los hay)..."
pkill -f Sniffer_udp.py 2>/dev/null
pkill -f Backend_app.py 2>/dev/null
sleep 1

echo "[iniciar.sh] arrancando el sniffer..."
nohup python3 -u Sniffer_udp.py > sniffer.log 2>&1 &
sleep 2
cat sniffer.log

echo "[iniciar.sh] arrancando Flask..."
nohup python3 -u Backend_app.py > flask.log 2>&1 &
sleep 2

echo "[iniciar.sh] probando el endpoint /actual..."
curl -s http://127.0.0.1:5001/actual
echo
echo "[iniciar.sh] listo. Revisa sniffer.log y flask.log si algo falló."
