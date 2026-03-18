#!/usr/bin/env python3
"""
iceboks.site dev server
Serves static files + handles art gallery and music uploads.
Auth: set UPLOAD_TOKEN env var. Requests must include Authorization: Bearer <token>
"""
import os
import json
import uuid
import hmac
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

SITE_DIR = os.path.dirname(os.path.abspath(__file__))
ART_DIR = os.path.join(SITE_DIR, 'art', 'images')
ART_CATALOG = os.path.join(SITE_DIR, 'art', 'catalog.json')
MUSIC_DIR = os.path.join(SITE_DIR, 'music')
UPLOAD_TOKEN = os.environ.get('UPLOAD_TOKEN', '')

os.makedirs(ART_DIR, exist_ok=True)


def load_catalog():
    try:
        with open(ART_CATALOG) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_catalog(catalog):
    with open(ART_CATALOG, 'w') as f:
        json.dump(catalog, f, indent=2)


class SiteHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SITE_DIR, **kwargs)

    def check_auth(self):
        """Verify Bearer token on upload endpoints. Returns True if authorized."""
        if not UPLOAD_TOKEN:
            self.send_error(503, 'UPLOAD_TOKEN not configured on server')
            return False
        auth = self.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            self.send_error(401, 'Missing Authorization: Bearer <token>')
            return False
        token = auth[7:]
        if not hmac.compare_digest(token, UPLOAD_TOKEN):
            self.send_error(403, 'Invalid token')
            return False
        return True

    def do_POST(self):
        path = urlparse(self.path).path

        if path == '/api/art/upload':
            if not self.check_auth():
                return
            self.handle_art_upload()
        elif path == '/api/music/upload':
            if not self.check_auth():
                return
            self.handle_music_upload()
        else:
            self.send_error(404)

    def handle_art_upload(self):
        content_type = self.headers.get('Content-Type', '')
        if 'multipart/form-data' not in content_type:
            self.send_error(400, 'Expected multipart/form-data')
            return

        # Parse multipart boundary
        boundary = content_type.split('boundary=')[1].encode()
        content_length = int(self.headers['Content-Length'])
        body = self.rfile.read(content_length)

        parts = body.split(b'--' + boundary)
        fields = {}
        file_data = None
        file_ext = 'png'

        for part in parts:
            if b'Content-Disposition' not in part:
                continue
            header, _, data = part.partition(b'\r\n\r\n')
            data = data.rstrip(b'\r\n--')
            header_str = header.decode('utf-8', errors='replace')

            if 'name="image"' in header_str:
                file_data = data
                if 'filename="' in header_str:
                    fname = header_str.split('filename="')[1].split('"')[0]
                    file_ext = fname.rsplit('.', 1)[-1].lower() if '.' in fname else 'png'
            else:
                # Extract field name
                name = header_str.split('name="')[1].split('"')[0]
                fields[name] = data.decode('utf-8', errors='replace').strip()

        if not file_data:
            self.send_error(400, 'No image file')
            return

        # Save file
        file_id = str(uuid.uuid4())[:12]
        filename = f"{file_id}.{file_ext}"
        filepath = os.path.join(ART_DIR, filename)

        with open(filepath, 'wb') as f:
            f.write(file_data)

        # Update catalog
        catalog = load_catalog()
        entry = {
            'src': f'art/images/{filename}',
            'title': fields.get('title', filename),
            'description': fields.get('description', ''),
            'category': fields.get('category', '')
        }
        catalog.append(entry)
        save_catalog(catalog)

        print(f"[art] Saved: {filename} ({len(file_data)} bytes) — {entry['title']}")

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({'ok': True, 'entry': entry}).encode())

    def handle_music_upload(self):
        content_type = self.headers.get('Content-Type', '')
        if 'multipart/form-data' not in content_type:
            self.send_error(400, 'Expected multipart/form-data')
            return

        boundary = content_type.split('boundary=')[1].encode()
        content_length = int(self.headers['Content-Length'])
        body = self.rfile.read(content_length)

        parts = body.split(b'--' + boundary)
        fields = {}
        mp3_data = None
        cover_data = None

        for part in parts:
            if b'Content-Disposition' not in part:
                continue
            header, _, data = part.partition(b'\r\n\r\n')
            data = data.rstrip(b'\r\n--')
            header_str = header.decode('utf-8', errors='replace')

            if 'name="mp3"' in header_str:
                mp3_data = data
            elif 'name="cover"' in header_str:
                cover_data = data
            else:
                name = header_str.split('name="')[1].split('"')[0]
                fields[name] = data.decode('utf-8', errors='replace').strip()

        if not mp3_data:
            self.send_error(400, 'No MP3 file')
            return

        song_id = str(uuid.uuid4())
        mp3_path = os.path.join(MUSIC_DIR, 'mp3', f'{song_id}.mp3')
        with open(mp3_path, 'wb') as f:
            f.write(mp3_data)

        if cover_data:
            cover_path = os.path.join(MUSIC_DIR, 'covers', f'{song_id}.jpeg')
            with open(cover_path, 'wb') as f:
                f.write(cover_data)

        # Update catalog
        catalog_path = os.path.join(MUSIC_DIR, 'catalog.json')
        try:
            with open(catalog_path) as f:
                catalog = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            catalog = []

        entry = {
            'title': fields.get('title', 'Untitled'),
            'songId': song_id,
            'style': fields.get('style', '')
        }
        catalog.append(entry)
        with open(catalog_path, 'w') as f:
            json.dump(catalog, f, indent=2)

        print(f"[music] Saved: {entry['title']} ({len(mp3_data)} bytes)")

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps({'ok': True, 'entry': entry}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()


if __name__ == '__main__':
    port = 8090
    token_status = 'SET' if UPLOAD_TOKEN else 'NOT SET (uploads will fail)'
    print(f"\niceboks.site dev server")
    print(f"  http://localhost:{port}")
    print(f"  Art uploads  → art/images/")
    print(f"  Music uploads → music/mp3/")
    print(f"  UPLOAD_TOKEN: {token_status}\n")
    server = HTTPServer(('0.0.0.0', port), SiteHandler)
    server.serve_forever()
