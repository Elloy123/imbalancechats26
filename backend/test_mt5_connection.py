"""
Diagnóstico MT5 - Execute para identificar problemas de conexão
"""

import os
import sys

print("=" * 60)
print("  DIAGNÓSTICO MetaTrader 5")
print("=" * 60)
print()

# 1. Verificar Python
print("1. VERIFICAÇÃO DO PYTHON")
print(f"   Versão: {sys.version}")
print(f"   Executável: {sys.executable}")
print()

# 2. Verificar biblioteca MT5
print("2. VERIFICAÇÃO DA BIBLIOTECA")
try:
    import MetaTrader5 as mt5
    print(f"   ✅ MetaTrader5 instalado")
    print(f"   Versão: {mt5.__version__}")
    print(f"   Path: {mt5.__file__}")
except ImportError as e:
    print(f"   ❌ MetaTrader5 NÃO instalado")
    print(f"   Erro: {e}")
    print()
    print("   Para instalar:")
    print("   pip install MetaTrader5")
    print()
    sys.exit(1)

print()

# 3. Procurar MT5 instalado
print("3. PROCURANDO MT5 INSTALADO")

MT5_PATHS = [
    # Exness
    os.path.expandvars(r"%ProgramFiles%\Exness - MetaTrader 5\terminal64.exe"),
    os.path.expandvars(r"%ProgramFiles(x86)%\Exness - MetaTrader 5\terminal64.exe"),
    os.path.expandvars(r"%LocalAppData%\Exness - MetaTrader 5\terminal64.exe"),
    os.path.expandvars(r"%AppData%\Exness - MetaTrader 5\terminal64.exe"),
    # Genérico
    os.path.expandvars(r"%ProgramFiles%\MetaTrader 5\terminal64.exe"),
    os.path.expandvars(r"%ProgramFiles(x86)%\MetaTrader 5\terminal64.exe"),
    os.path.expandvars(r"%LocalAppData%\MetaTrader 5\terminal64.exe"),
    os.path.expandvars(r"%AppData%\MetaTrader 5\terminal64.exe"),
    # Outros
    os.path.expandvars(r"%LocalAppData%\Programs\MetaTrader 5\terminal64.exe"),
]

mt5_found = None
for path in MT5_PATHS:
    expanded = os.path.expandvars(path)
    exists = os.path.exists(expanded)
    status = "✅ ENCONTRADO" if exists else "❌"
    print(f"   {status} {expanded}")
    if exists and not mt5_found:
        mt5_found = expanded

print()

# 4. Tentar inicializar MT5
print("4. TENTANDO CONECTAR AO MT5")

if mt5_found:
    print(f"   Usando caminho: {mt5_found}")
else:
    print("   Tentando detecção automática...")

# Tentar inicializar SEM path
print("\n   Teste 1: Inicialização automática (sem path)...")
try:
    if mt5.initialize():
        print("   ✅ SUCESSO!")
    else:
        error = mt5.last_error()
        print(f"   ❌ Falhou: {error}")
        mt5.shutdown()
except Exception as e:
    print(f"   ❌ Exceção: {e}")

# Tentar inicializar COM path
if mt5_found:
    print(f"\n   Teste 2: Com caminho específico...")
    try:
        if mt5.initialize(path=mt5_found):
            print("   ✅ SUCESSO!")
        else:
            error = mt5.last_error()
            print(f"   ❌ Falhou: {error}")
            mt5.shutdown()
    except Exception as e:
        print(f"   ❌ Exceção: {e}")

# Tentar inicializar com credenciais
print("\n   Teste 3: Com credenciais (coloque sua senha!)...")
MT5_CONFIG = {
    "login": 65261682,
    "password": "Fcom4040#",  # SUBSTITUA!
    "server": "Exness-MT5Real11",
}

print(f"   Login: {MT5_CONFIG['login']}")
print(f"   Server: {MT5_CONFIG['server']}")

if MT5_CONFIG['password'] == "SUA_SENHA_AQUI":
    print("   ⚠️  Configure sua senha no script!")
else:
    try:
        init_params = {
            "login": MT5_CONFIG["login"],
            "password": MT5_CONFIG["password"],
            "server": MT5_CONFIG["server"],
            "timeout": 60000,
        }
        if mt5_found:
            init_params["path"] = mt5_found

        if mt5.initialize(**init_params):
            print("   ✅ CONECTADO!")

            account = mt5.account_info()
            if account:
                print(f"\n   CONTA:")
                print(f"   • Login: {account.login}")
                print(f"   • Servidor: {account.server}")
                print(f"   • Nome: {account.name}")
                print(f"   • Saldo: {account.balance} {account.currency}")

            mt5.shutdown()
        else:
            error = mt5.last_error()
            print(f"   ❌ Falhou: {error}")
    except Exception as e:
        print(f"   ❌ Exceção: {e}")

print()
print("=" * 60)
print("  RESULTADO DO DIAGNÓSTICO")
print("=" * 60)
print()

if mt5_found:
    print(f"✅ MT5 encontrado em: {mt5_found}")
    print()
    print("PRÓXIMOS PASSOS:")
    print("1. Abra o MT5 manualmente")
    print("2. Faça login na sua conta Exness")
    print("3. Execute o servidor novamente")
else:
    print("❌ MT5 NÃO encontrado!")
    print()
    print("POSSÍVEIS SOLUÇÕES:")
    print("1. Instale o MT5 da Exness")
    print("2. Verifique onde o MT5 foi instalado")
    print("3. Adicione o caminho manualmente no código")

print()
print("=" * 60)
