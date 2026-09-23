#!/bin/bash
cd "$(dirname "$0")/Web Server Flask" || cd "$HOME/telemetry_mobile_app/Web Server Flask"

echo "==> [1/3] Actualizando permisos de ejecución..."
chmod +x iniciar.sh

echo "==> [2/3] Reiniciando Sniffer UDP y Backend Flask..."
./iniciar.sh

echo "==> [3/3] Recargando Nginx..."
sudo systemctl reload nginx || sudo systemctl restart nginx

echo "==> ¡Despliegue finalizado con éxito!"
