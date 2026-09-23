"""
Backend_app.py — Solo las rutas Flask.

Toda la lógica de base de datos vive en db.py. Todo el HTML vive en
templates/index.html. Todo el CSS y JavaScript viven en static/.
Este archivo solo conecta: "cuando piden esta URL, llama a esta
función de db.py y devuelve el resultado".
"""

from flask import Flask, jsonify, render_template, request

import db

app = Flask(__name__, template_folder='Frontend')


@app.route("/actual")
def actual():
    try:
        datos = db.obtener_ultima_coordenada()
    except Exception as error:
        return jsonify({"error": f"No se pudo consultar la base de datos: {error}"}), 500

    if datos is None:
        return jsonify({"id": 0, "lat": None, "lon": None, "fecha": "-", "hora": "-", "servidor": "-"})
    return jsonify(datos)


@app.route("/recorrido")
def recorrido():
    desde_id = request.args.get("desde", default=0, type=int)
    try:
        puntos = db.obtener_recorrido(desde_id)
    except Exception as error:
        return jsonify({"error": f"No se pudo consultar la base de datos: {error}"}), 500
    return jsonify(puntos)


@app.route("/historico")
def historico():
    """
    Espera ?desde=YYYY-MM-DDTHH:MM&hasta=YYYY-MM-DDTHH:MM (hora de
    Colombia, formato que entrega un <input type="datetime-local">).
    """
    from datetime import datetime

    desde_str = request.args.get("desde")
    hasta_str = request.args.get("hasta")

    if not desde_str or not hasta_str:
        return jsonify({"error": "Debes indicar 'desde' y 'hasta'"}), 400

    try:
        desde_dt = datetime.fromisoformat(desde_str).replace(tzinfo=db.ZONA_LOCAL)
        hasta_dt = datetime.fromisoformat(hasta_str).replace(tzinfo=db.ZONA_LOCAL)
    except ValueError:
        return jsonify({"error": "Formato de fecha/hora inválido"}), 400

    if hasta_dt < desde_dt:
        return jsonify({"error": "'hasta' no puede ser anterior a 'desde'"}), 400

    desde_ms = int(desde_dt.timestamp() * 1000)
    hasta_ms = int(hasta_dt.timestamp() * 1000)

    try:
        puntos = db.obtener_historico(desde_ms, hasta_ms)
    except Exception as error:
        return jsonify({"error": f"No se pudo consultar la base de datos: {error}"}), 500

    return jsonify(puntos)


@app.route("/")
def pagina_principal():
    return render_template("index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
