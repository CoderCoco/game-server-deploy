"""
Game Server Manager — Local Flask Web UI.
Run with: python app.py
"""

from flask import Flask, jsonify, render_template, request

from server_manager import (
    estimate_costs,
    get_actual_costs,
    get_all_statuses,
    get_config,
    get_game_names,
    get_recent_logs,
    get_server_status,
    invalidate_tf_cache,
    save_config,
    start_server,
    stop_server,
)

app = Flask(__name__)


# ── Pages ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ── API: games list ───────────────────────────────────────────────────────────

@app.route("/api/games")
def api_games():
    invalidate_tf_cache()
    return jsonify({"games": get_game_names()})


# ── API: status ───────────────────────────────────────────────────────────────

@app.route("/api/status")
def api_status_all():
    invalidate_tf_cache()
    return jsonify(get_all_statuses())


@app.route("/api/status/<game>")
def api_status_game(game):
    return jsonify(get_server_status(game))


# ── API: start / stop ─────────────────────────────────────────────────────────

@app.route("/api/start/<game>", methods=["POST"])
def api_start(game):
    return jsonify(start_server(game))


@app.route("/api/stop/<game>", methods=["POST"])
def api_stop(game):
    return jsonify(stop_server(game))


# ── API: config ───────────────────────────────────────────────────────────────

@app.route("/api/config", methods=["GET"])
def api_get_config():
    return jsonify(get_config())


@app.route("/api/config", methods=["POST"])
def api_save_config():
    data   = request.get_json(force=True)
    config = get_config()
    for key in config:
        if key in data:
            config[key] = data[key]
    save_config(config)
    return jsonify({"success": True, "config": config})


# ── API: costs ────────────────────────────────────────────────────────────────

@app.route("/api/costs/estimate")
def api_cost_estimate():
    return jsonify(estimate_costs())


@app.route("/api/costs/actual")
def api_actual_costs():
    days = request.args.get("days", 7, type=int)
    return jsonify(get_actual_costs(days))


# ── API: logs ─────────────────────────────────────────────────────────────────

@app.route("/api/logs/<game>")
def api_logs(game):
    limit = request.args.get("limit", 50, type=int)
    return jsonify({"game": game, "lines": get_recent_logs(game, limit)})


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n  🎮  Game Server Manager")
    print("  ─────────────────────────────")
    print("  Open http://localhost:5000 in your browser\n")
    app.run(host="0.0.0.0", port=5000, debug=True)
