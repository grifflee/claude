#!/usr/bin/env python3
"""
EcoSim Local Server

Serves the app and provides REST endpoints for saving/loading universes
to actual JSON files on disk in the saves/ directory.

Usage:
    python3 server.py
    # Then visit http://localhost:8000

Endpoints:
    GET  /                     - Serves the app
    GET  /api/universes        - List all saved universes
    GET  /api/universes/<name> - Load a specific universe
    POST /api/universes/<name> - Save a universe
    DELETE /api/universes/<name> - Delete a universe
"""

import http.server
import json
import os
import re
import time
import urllib.parse

PORT = 8000
SAVES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'saves')

# Ensure saves directory exists
os.makedirs(SAVES_DIR, exist_ok=True)


def safe_filename(name):
    """Convert a universe name to a safe filename."""
    # Replace spaces with underscores, remove non-alphanumeric chars
    safe = re.sub(r'[^\w\s-]', '', name).strip()
    safe = re.sub(r'\s+', '_', safe)
    return safe + '.json' if safe else None


def name_from_filename(filename):
    """Convert a filename back to a universe name."""
    name = filename.replace('.json', '').replace('_', ' ')
    return name


class EcoSimHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # API: List all universes
        if path == '/api/universes':
            self.send_json(self.list_universes())
            return

        # API: Load a specific universe
        if path.startswith('/api/universes/'):
            name = urllib.parse.unquote(path[len('/api/universes/'):])
            data = self.load_universe(name)
            if data is not None:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data.encode('utf-8'))
            else:
                self.send_error(404, 'Universe not found')
            return

        # Serve static files
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # API: Save a universe
        if path.startswith('/api/universes/'):
            name = urllib.parse.unquote(path[len('/api/universes/'):])
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')

            if self.save_universe(name, body):
                self.send_json({'ok': True, 'name': name})
            else:
                self.send_error(400, 'Failed to save')
            return

        self.send_error(404)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # API: Delete a universe
        if path.startswith('/api/universes/'):
            name = urllib.parse.unquote(path[len('/api/universes/'):])
            if self.delete_universe(name):
                self.send_json({'ok': True})
            else:
                self.send_error(404, 'Universe not found')
            return

        self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def send_json(self, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def list_universes(self):
        universes = []
        if not os.path.exists(SAVES_DIR):
            return universes
        for f in sorted(os.listdir(SAVES_DIR)):
            if not f.endswith('.json'):
                continue
            filepath = os.path.join(SAVES_DIR, f)
            try:
                stat = os.stat(filepath)
                # Read just the metadata fields from the save
                with open(filepath, 'r') as fh:
                    data = json.load(fh)
                universes.append({
                    'name': name_from_filename(f),
                    'filename': f,
                    'tick': data.get('tick', 0),
                    'generation': data.get('maxGeneration', 0),
                    'population': len(data.get('creatures', [])),
                    'savedAt': int(stat.st_mtime * 1000),
                    'fileSize': stat.st_size
                })
            except Exception:
                continue
        return universes

    def load_universe(self, name):
        filename = safe_filename(name)
        if not filename:
            return None
        filepath = os.path.join(SAVES_DIR, filename)
        if not os.path.exists(filepath):
            return None
        with open(filepath, 'r') as f:
            return f.read()

    def save_universe(self, name, data):
        filename = safe_filename(name)
        if not filename:
            return False
        filepath = os.path.join(SAVES_DIR, filename)
        try:
            with open(filepath, 'w') as f:
                f.write(data)
            return True
        except Exception as e:
            print(f'Save error: {e}')
            return False

    def delete_universe(self, name):
        filename = safe_filename(name)
        if not filename:
            return False
        filepath = os.path.join(SAVES_DIR, filename)
        if os.path.exists(filepath):
            os.remove(filepath)
            return True
        return False

    def log_message(self, format, *args):
        # Suppress static file logs, only show API calls
        if '/api/' in (args[0] if args else ''):
            super().log_message(format, *args)


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.HTTPServer(('', PORT), EcoSimHandler)
    print(f'\033[96m🧬 EcoSim server running at http://localhost:{PORT}\033[0m')
    print(f'\033[90m   Saves directory: {SAVES_DIR}\033[0m')
    print(f'\033[90m   Press Ctrl+C to stop\033[0m')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n\033[93mServer stopped.\033[0m')
        server.server_close()
