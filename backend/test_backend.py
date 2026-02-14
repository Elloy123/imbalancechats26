# test_backend.py - Verifica se o backend tem /history
# Rode: python test_backend.py

import urllib.request
import json
import sys

BASE = "http://localhost:8000"

def test(url, label):
    try:
        req = urllib.request.urlopen(url, timeout=5)
        data = json.loads(req.read())
        print(f"  ✅ {label}: OK")
        return data
    except urllib.error.HTTPError as e:
        print(f"  ❌ {label}: HTTP {e.code} - ENDPOINT NÃO EXISTE!")
        return None
    except Exception as e:
        print(f"  ❌ {label}: {e}")
        return None

print("=" * 50)
print("  Teste do Backend MT5 Bridge")
print("=" * 50)

# Test 1: Root
print("\n1. Testando /")
root = test(BASE + "/", "GET /")
if root:
    v = root.get("v", "???")
    print(f"     Versão: {v}")
    if "routes" in root:
        print(f"     Rotas: {root['routes']}")
    if v < "5.1":
        print(f"\n  ⚠️  VERSÃO ANTIGA ({v})! Substitua o mt5_bridge_server.py pelo novo!")
        sys.exit(1)

# Test 2: Health
print("\n2. Testando /health")
health = test(BASE + "/health", "GET /health")
if health:
    print(f"     MT5: {'conectado' if health.get('mt5_connected') else 'desconectado'}")
    print(f"     Modo: {health.get('mode')}")

# Test 3: History (THE CRITICAL ONE)
print("\n3. Testando /history/EURUSD?hours=0.1")
hist = test(BASE + "/history/EURUSD?hours=0.1", "GET /history")
if hist:
    print(f"     Ticks retornados: {hist.get('count', 0)}")
    if hist.get('count', 0) > 0:
        print(f"     ✅ HISTÓRICO FUNCIONANDO!")
    elif hist.get('error'):
        print(f"     ⚠️  Erro: {hist['error']}")
    else:
        print(f"     ⚠️  Sem ticks (mercado fechado?)")
elif hist is None:
    print(f"\n  ❌ /history NÃO EXISTE no seu backend!")
    print(f"  ❌ Você está rodando o arquivo ANTIGO!")
    print(f"  ❌ SOLUÇÃO: Substitua mt5_bridge_server.py pelo novo (do zip)")

print("\n" + "=" * 50)
