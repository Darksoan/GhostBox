import os
import sys
import json
import secrets
import subprocess
import traceback
from urllib.parse import urlparse, parse_qs
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# Configurações do Workspace
WORKSPACE_DIR = Path(r"E:\GhostBox").resolve()
PORT = 7777

# Token de autenticação
AUTH_TOKEN = os.environ.get("DEVSPACE_TOKEN", "")
if not AUTH_TOKEN:
    # Caso não seja fornecido por env var, gera um novo para esta sessão
    AUTH_TOKEN = secrets.token_hex(16)
    print(f"[*] DEVSPACE_TOKEN não configurado. Token gerado: {AUTH_TOKEN}")
else:
    print(f"[*] Usando token configurado via ambiente: {AUTH_TOKEN}")

# Pastas a serem ignoradas na busca e árvore de arquivos
IGNORED_DIRS = {
    ".git", "node_modules", ".devspace", "dist", ".wrangler",
    "venv", ".venv", "__pycache__", ".commandcode", ".cursor", ".vscode"
}

def safe_path(relative_path_str):
    """Garante que o caminho é seguro e está dentro do WORKSPACE_DIR."""
    if not relative_path_str:
        return WORKSPACE_DIR

    # Normalizar caminhos com barras / ou \
    normalized_path = relative_path_str.replace("\\", "/")
    # Remove barras iniciais
    if normalized_path.startswith("/"):
        normalized_path = normalized_path[1:]

    resolved_path = (WORKSPACE_DIR / normalized_path).resolve()

    # Verifica se o caminho resolvido começa com o caminho do workspace
    if resolved_path == WORKSPACE_DIR or WORKSPACE_DIR in resolved_path.parents:
        return resolved_path

    raise PermissionError("Acesso fora do Workspace não permitido.")

def list_tree(directory, current_depth=0, max_depth=3):
    """Retorna uma estrutura de árvore simplificada."""
    result = []
    try:
        for entry in os.scandir(directory):
            if entry.name in IGNORED_DIRS:
                continue

            rel_path = os.path.relpath(entry.path, WORKSPACE_DIR).replace("\\", "/")

            if entry.is_dir():
                item = {
                    "name": entry.name,
                    "path": rel_path,
                    "type": "directory"
                }
                if current_depth < max_depth:
                    item["children"] = list_tree(entry.path, current_depth + 1, max_depth)
                result.append(item)
            elif entry.is_file():
                result.append({
                    "name": entry.name,
                    "path": rel_path,
                    "type": "file",
                    "size": entry.stat().st_size
                })
    except Exception as e:
        print(f"Erro ao listar {directory}: {e}")

    # Ordena diretórios primeiro, depois arquivos
    result.sort(key=lambda x: (x["type"] != "directory", x["name"].lower()))
    return result

class DevSpaceHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        sys.stderr.write("%s - - [%s] %s\n" %
                         (self.address_string(),
                          self.log_date_time_string(),
                          format%args))

    def send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def check_auth(self):
        """Verifica se o token está correto."""
        auth_header = self.headers.get("Authorization")
        if not auth_header:
            return False

        parts = auth_header.split(" ")
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return False

        return secrets.compare_digest(parts[1], AUTH_TOKEN)

    def do_OPTIONS(self):
        """Trata requisições de CORS Preflight."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        query = parse_qs(parsed_url.query)

        if path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            html = f"""<!DOCTYPE html>
<html>
<head>
    <title>GhostBox DevSpace Status</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px; line-height: 1.6; }}
        .card {{ background: #1e293b; border-radius: 12px; padding: 30px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); max-width: 600px; margin: 0 auto; border: 1px solid #334155; }}
        h1 {{ color: #38bdf8; margin-top: 0; }}
        .status {{ display: inline-block; padding: 4px 12px; border-radius: 9999px; font-weight: bold; font-size: 0.875rem; }}
        .status.online {{ background: #059669; color: #ecfdf5; }}
        code {{ background: #0f172a; padding: 4px 8px; border-radius: 4px; font-family: monospace; color: #f43f5e; }}
        pre {{ background: #0f172a; padding: 15px; border-radius: 6px; overflow-x: auto; }}
    </style>
</head>
<body>
    <div class="card">
        <h1>GhostBox DevSpace 🚀</h1>
        <p>Status: <span class="status online">Online & Ativo</span></p>
        <p>Workspace exposto: <code>{WORKSPACE_DIR}</code></p>
        <p><strong>Configuração de Autenticação:</strong></p>
        <p>Use o header <code>Authorization: Bearer [TOKEN]</code> para requisições na API.</p>
        <p>Para ver a especificação OpenAPI, acesse o arquivo local em <code>.devspace/openapi.yaml</code></p>
    </div>
</body>
</html>"""
            self.wfile.write(html.encode("utf-8"))
            return

        if not self.check_auth():
            self.send_json(401, {"error": "Não autorizado. Token inválido ou ausente."})
            return

        try:
            if path == "/api/tree":
                max_d = int(query.get("depth", [3])[0])
                tree = list_tree(WORKSPACE_DIR, max_depth=max_d)
                self.send_json(200, {"tree": tree})
                return

            elif path == "/api/file":
                file_param = query.get("path", [""])[0]
                if not file_param:
                    self.send_json(400, {"error": "Parâmetro 'path' é obrigatório."})
                    return

                target = safe_path(file_param)
                if not target.exists():
                    self.send_json(404, {"error": "Arquivo não encontrado."})
                    return
                if not target.is_file():
                    self.send_json(400, {"error": "O caminho não é um arquivo."})
                    return

                try:
                    with open(target, 'r', encoding='utf-8') as f:
                        content = f.read()
                    self.send_json(200, {"path": file_param, "content": content})
                except UnicodeDecodeError:
                    self.send_json(400, {"error": "Não é possível exibir arquivos binários."})
                return

            elif path == "/api/search":
                q = query.get("q", [""])[0]
                if not q:
                    self.send_json(400, {"error": "Parâmetro 'q' (termo de busca) é obrigatório."})
                    return

                matches = []
                for root, dirs, files in os.walk(WORKSPACE_DIR):
                    dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]

                    for file in files:
                        file_path = Path(root) / file
                        rel_path = os.path.relpath(file_path, WORKSPACE_DIR).replace("\\", "/")

                        try:
                            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                                for line_num, line in enumerate(f, 1):
                                    if q.lower() in line.lower():
                                        matches.append({
                                            "path": rel_path,
                                            "line": line_num,
                                            "content": line.strip()
                                        })
                                        if len(matches) >= 100:
                                            break
                        except Exception:
                            pass
                        if len(matches) >= 100:
                            break
                    if len(matches) >= 100:
                        break

                self.send_json(200, {"query": q, "results": matches})
                return

            else:
                self.send_json(404, {"error": "Rota não encontrada."})

        except PermissionError as e:
            self.send_json(403, {"error": f"Acesso negado: {e}"})
        except Exception as e:
            traceback.print_exc()
            self.send_json(500, {"error": str(e)})

    def do_POST(self):
        if not self.check_auth():
            self.send_json(401, {"error": "Não autorizado."})
            return

        parsed_url = urlparse(self.path)
        path = parsed_url.path

        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body_data = self.rfile.read(content_length).decode('utf-8')

            try:
                body = json.loads(body_data) if body_data else {}
            except json.JSONDecodeError:
                self.send_json(400, {"error": "JSON do corpo inválido."})
                return

            if path == "/api/file":
                file_param = body.get("path")
                content = body.get("content", "")

                if not file_param:
                    self.send_json(400, {"error": "Propriedade 'path' no body é obrigatória."})
                    return

                target = safe_path(file_param)
                target.parent.mkdir(parents=True, exist_ok=True)

                with open(target, 'w', encoding='utf-8') as f:
                    f.write(content)

                self.send_json(200, {"success": True, "message": f"Arquivo {file_param} gravado com sucesso."})
                return

            elif path == "/api/exec":
                cmd = body.get("cmd")
                if not cmd:
                    self.send_json(400, {"error": "Propriedade 'cmd' no body é obrigatória."})
                    return

                print(f"[*] Executando comando: {cmd}")

                result = subprocess.run(
                    ["powershell", "-Command", cmd],
                    cwd=WORKSPACE_DIR,
                    capture_output=True,
                    text=True,
                    timeout=30
                )

                self.send_json(200, {
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "exit_code": result.returncode
                })
                return

            else:
                self.send_json(404, {"error": "Rota não encontrada."})

        except PermissionError as e:
            self.send_json(403, {"error": f"Acesso negado: {e}"})
        except subprocess.TimeoutExpired:
            self.send_json(500, {"error": "Comando excedeu o tempo limite de 30 segundos."})
        except Exception as e:
            traceback.print_exc()
            self.send_json(500, {"error": str(e)})

    def do_PUT(self):
        self.do_POST()

    def do_DELETE(self):
        if not self.check_auth():
            self.send_json(401, {"error": "Não autorizado."})
            return

        parsed_url = urlparse(self.path)
        path = parsed_url.path
        query = parse_qs(parsed_url.query)

        if path == "/api/file":
            file_param = query.get("path", [""])[0]
            if not file_param:
                self.send_json(400, {"error": "Parâmetro 'path' é obrigatório."})
                return

            try:
                target = safe_path(file_param)
                if not target.exists():
                    self.send_json(404, {"error": "Arquivo não encontrado."})
                    return

                if target.is_file():
                    target.unlink()
                elif target.is_dir():
                    self.send_json(400, {"error": "Remoção direta de pastas não permitida."})
                    return

                self.send_json(200, {"success": True, "message": f"Arquivo {file_param} deletado."})
            except PermissionError as e:
                self.send_json(403, {"error": f"Acesso negado: {e}"})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
        else:
            self.send_json(404, {"error": "Rota não encontrada."})

def run_server():
    server_address = ('127.0.0.1', PORT)
    httpd = HTTPServer(server_address, DevSpaceHandler)
    print(f"[*] DevSpace Server rodando em http://localhost:{PORT}")
    print(f"[*] Workspace: {WORKSPACE_DIR}")
    print(f"[*] Token de Acesso: {AUTH_TOKEN}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Desligando o servidor...")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
