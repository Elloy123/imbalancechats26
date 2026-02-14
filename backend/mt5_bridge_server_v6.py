"""
MT5 Bridge Server v6.1 - Corrigido para Exness
Correções:
- Detecção automática do caminho do MT5
- Melhor tratamento de erros
- Logs mais detalhados
"""

import asyncio
import json
import logging
import math
import random
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, List
from dataclasses import dataclass, asdict
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# ==========================================
# DETECÇÃO DO MT5
# ==========================================

# Possíveis caminhos do MT5 no Windows
MT5_POSSIBLE_PATHS = [
    # Exness MT5
    os.path.expandvars(r"%ProgramFiles%\Exness - MetaTrader 5\terminal64.exe"),
    os.path.expandvars(r"%ProgramFiles(x86)%\Exness - MetaTrader 5\terminal64.exe"),
    os.path.expandvars(r"%AppData%\Exness - MetaTrader 5\terminal64.exe"),
    os.path.expandvars(r"%LocalAppData%\Exness - MetaTrader 5\terminal64.exe"),
    # MT5 Genérico
    os.path.expandvars(r"%ProgramFiles%\MetaTrader 5\terminal64.exe"),
    os.path.expandvars(r"%ProgramFiles(x86)%\MetaTrader 5\terminal64.exe"),
    os.path.expandvars(r"%AppData%\MetaTrader 5\terminal64.exe"),
    os.path.expandvars(r"%LocalAppData%\MetaTrader 5\terminal64.exe"),
    # Outros corretores comuns
    os.path.expandvars(r"%ProgramFiles%\MetaTrader 5 Terminal\terminal64.exe"),
    os.path.expandvars(r"%LocalAppData%\Programs\MetaTrader 5\terminal64.exe"),
]

def find_mt5_path() -> Optional[str]:
    """Tenta encontrar o caminho do MT5 automaticamente"""
    print("\n🔍 Procurando MT5 instalado...")

    for path in MT5_POSSIBLE_PATHS:
        expanded = os.path.expandvars(path)
        if os.path.exists(expanded):
            print(f"   ✅ Encontrado: {expanded}")
            return expanded
        # Também verificar sem terminal64.exe (pasta)
        folder = os.path.dirname(expanded)
        if os.path.exists(folder):
            exe = os.path.join(folder, "terminal64.exe")
            if os.path.exists(exe):
                print(f"   ✅ Encontrado: {exe}")
                return exe

    print("   ❌ MT5 não encontrado nos caminhos padrão")
    print("\n📁 Caminhos verificados:")
    for path in MT5_POSSIBLE_PATHS[:5]:
        print(f"   • {os.path.expandvars(path)}")

    return None

# Tentar importar MT5
try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
    print("✅ Biblioteca MetaTrader5 disponível")
except ImportError as e:
    MT5_AVAILABLE = False
    print(f"❌ Biblioteca MetaTrader5 não instalada: {e}")
    print("   Execute: pip install MetaTrader5")

# ==========================================
# CONFIGURAÇÃO DE LOGGING
# ==========================================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)-8s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# ==========================================
# CONFIGURAÇÃO DOS SÍMBOLOS
# ==========================================

SYM_CFG = {
    'EURUSD': {'mult': 100000.0, 'bv': 5.0, 'dig': 5, 'base': 1.0850},
    'GBPUSD': {'mult': 100000.0, 'bv': 5.0, 'dig': 5, 'base': 1.2650},
    'USDJPY': {'mult': 1000.0, 'bv': 5.0, 'dig': 3, 'base': 149.50},
    'XAUUSD': {'mult': 50.0, 'bv': 10.0, 'dig': 2, 'base': 2350.0},
    'USTEC':  {'mult': 2.0, 'bv': 10.0, 'dig': 2, 'base': 18500.0},
    'US100':  {'mult': 2.0, 'bv': 10.0, 'dig': 2, 'base': 18500.0},
    'NAS100': {'mult': 2.0, 'bv': 10.0, 'dig': 2, 'base': 18500.0},
    'BTCUSD': {'mult': 1.0, 'bv': 5.0, 'dig': 2, 'base': 67000.0},
}

def gcfg(symbol: str) -> dict:
    return SYM_CFG.get(symbol.upper(), {'mult': 1000.0, 'bv': 5.0, 'dig': 5, 'base': 1.0})

# ==========================================
# CREDENCIAIS MT5 - CONFIGURE AQUI!
# ==========================================

MT5_CONFIG = {
    "login": 65261682,                    # Seu número de conta Exness
    "password": "Fcom4040#",          # ⚠️ SUBSTITUA PELA SUA SENHA
    "server": "Exness-MT5Real11",          # Servidor da Exness
    "timeout": 60000,
}

# ==========================================
# DATA CLASSES
# ==========================================

@dataclass
class TickData:
    symbol: str
    price: float
    bid: float
    ask: float
    volume_synthetic: float
    side: str
    timestamp: int
    price_change: float
    spread: float
    source: str = "simulation"

    def to_dict(self) -> dict:
        return asdict(self)

# ==========================================
# VOLUME CALCULATOR
# ==========================================

class VolumeCalculator:
    def __init__(self):
        self.last_bid: Dict[str, float] = {}
        self.last_mid: Dict[str, float] = {}
        self._initialized: Dict[str, bool] = {}

    def calc(self, symbol: str, bid: float, ask: float) -> tuple:
        config = gcfg(symbol)
        mid = (bid + ask) / 2

        if symbol not in self._initialized:
            self.last_bid[symbol] = bid
            self.last_mid[symbol] = mid
            self._initialized[symbol] = True
            vol = config['bv'] * (0.8 + random.random() * 0.4)
            return mid, vol, 0.0, 'buy' if random.random() > 0.5 else 'sell'

        price_change = mid - self.last_mid[symbol]
        bid_change = bid - self.last_bid[symbol]

        vol = abs(price_change) * config['mult'] + config['bv']
        vol *= (0.7 + random.random() * 0.6)
        vol = max(vol, config['bv'])

        if random.random() > 0.97:
            vol *= (3 + random.random() * 5)

        if bid_change > 0:
            side = 'buy'
        elif bid_change < 0:
            side = 'sell'
        else:
            side = 'buy' if random.random() > 0.5 else 'sell'

        self.last_bid[symbol] = bid
        self.last_mid[symbol] = mid

        return mid, vol, price_change, side

    def reset(self, symbol: str = None):
        if symbol:
            self.last_bid.pop(symbol, None)
            self.last_mid.pop(symbol, None)
            self._initialized.pop(symbol, None)
        else:
            self.last_bid.clear()
            self.last_mid.clear()
            self._initialized.clear()

# ==========================================
# MT5 CONNECTOR
# ==========================================

class MT5Connector:
    def __init__(self):
        self.connected = False
        self.vc = VolumeCalculator()
        self.on_tick = None
        self.tick_count = 0
        self._should_reconnect = True
        self.mt5_path = None

    def init(self) -> bool:
        if not MT5_AVAILABLE:
            logger.warning("⚠️ Biblioteca MT5 não disponível")
            return False

        logger.info("🔌 Inicializando MT5...")

        # Encontrar caminho do MT5
        self.mt5_path = find_mt5_path()

        try:
            # Tentar inicializar SEM path primeiro (deixa MT5 detectar)
            logger.info("   Tentando inicialização automática...")

            init_params = {
                "login": MT5_CONFIG["login"],
                "password": MT5_CONFIG["password"],
                "server": MT5_CONFIG["server"],
                "timeout": MT5_CONFIG["timeout"],
            }

            # Só adicionar path se encontrou
            if self.mt5_path:
                init_params["path"] = self.mt5_path
                logger.info(f"   Caminho MT5: {self.mt5_path}")

            # Tentar inicializar
            if not mt5.initialize(**init_params):
                error = mt5.last_error()
                logger.error(f"❌ Falha na inicialização: {error}")

                # Tentar sem credenciais (conexão já existente)
                logger.info("   Tentando conectar sem credenciais (MT5 já aberto)...")
                if not mt5.initialize():
                    error = mt5.last_error()
                    logger.error(f"❌ Também falhou: {error}")
                    return False

            self.connected = True

            # Verificar conta
            account = mt5.account_info()
            if account:
                logger.info("=" * 50)
                logger.info("✅ MT5 CONECTADO COM SUCESSO!")
                logger.info("=" * 50)
                logger.info(f"   Conta:    {account.login}")
                logger.info(f"   Servidor: {account.server}")
                logger.info(f"   Nome:     {account.name}")
                logger.info(f"   Saldo:    {account.balance:.2f} {account.currency}")
                logger.info(f"   Equity:   {account.equity:.2f}")
                logger.info(f"   Alavancagem: 1:{account.leverage}")
                logger.info("=" * 50)
            else:
                logger.warning("⚠️ Conectado mas sem info da conta")
                logger.info("   Verifique se o MT5 está logado na conta correta")

            return True

        except Exception as e:
            logger.error(f"❌ Erro ao conectar MT5: {e}")
            import traceback
            traceback.print_exc()
            return False

    def shutdown(self):
        if self.connected:
            mt5.shutdown()
            self.connected = False
            logger.info("🔌 MT5 desconectado")

    async def listen(self, symbol: str = "EURUSD"):
        if not self.connected:
            return

        # Habilitar símbolo
        logger.info(f"📈 Habilitando símbolo: {symbol}")

        if not mt5.symbol_select(symbol, True):
            logger.error(f"❌ Não foi possível habilitar {symbol}")
            # Listar símbolos disponíveis
            logger.info("   Símbolos disponíveis:")
            symbols = mt5.symbols_get()
            if symbols:
                for s in symbols[:20]:
                    logger.info(f"      • {s.name}")
            return

        # Verificar info do símbolo
        info = mt5.symbol_info(symbol)
        if info:
            logger.info(f"✅ {symbol} pronto:")
            logger.info(f"   Bid: {info.bid}")
            logger.info(f"   Ask: {info.ask}")
            logger.info(f"   Spread: {info.spread}")
        else:
            logger.warning(f"⚠️ Info não disponível para {symbol}")

        last_time = 0

        while self.connected:
            try:
                tick = mt5.symbol_info_tick(symbol)

                if tick and tick.time != last_time:
                    last_time = tick.time
                    self.tick_count += 1

                    if tick.bid > 0 and tick.ask > 0:
                        mid, vol, pc, side = self.vc.calc(symbol, tick.bid, tick.ask)
                        config = gcfg(symbol)

                        td = TickData(
                            symbol=symbol,
                            price=round(mid, config['dig']),
                            bid=round(tick.bid, config['dig']),
                            ask=round(tick.ask, config['dig']),
                            volume_synthetic=round(vol, 2),
                            side=side,
                            timestamp=int(datetime.now().timestamp() * 1000),
                            price_change=round(pc, config['dig']),
                            spread=round(tick.ask - tick.bid, config['dig']),
                            source="mt5"
                        )

                        if self.tick_count % 100 == 0:
                            logger.info(f"📊 #{self.tick_count}: {symbol} {tick.bid:.{config['dig']}f} / {tick.ask:.{config['dig']}f}")

                        if self.on_tick:
                            await self.on_tick(td)

                await asyncio.sleep(0.05)

            except Exception as e:
                logger.error(f"❌ Erro: {e}")
                await asyncio.sleep(1)

    def get_history(self, symbol: str, hours: float) -> List[dict]:
        if not self.connected or not MT5_AVAILABLE:
            return []

        if not mt5.symbol_select(symbol, True):
            logger.error(f"[HIST] {symbol} indisponível")
            return []

        utc_to = datetime.now(timezone.utc)
        utc_from = utc_to - timedelta(hours=hours)

        logger.info(f"[HIST] {symbol}: {hours}h")

        try:
            raw = mt5.copy_ticks_range(symbol, utc_from, utc_to, mt5.COPY_TICKS_ALL)

            if raw is None or len(raw) == 0:
                raw = mt5.copy_ticks_from(symbol, utc_from, 500000, mt5.COPY_TICKS_ALL)

            if raw is None or len(raw) == 0:
                logger.error(f"[HIST] Sem ticks")
                return []

            logger.info(f"[HIST] {len(raw)} ticks brutos")

            vc = VolumeCalculator()
            config = gcfg(symbol)
            result = []

            for t in raw:
                try:
                    bid = float(t['bid'])
                    ask = float(t['ask'])
                    ts = int(t['time'])
                    try:
                        tms = int(t['time_msc'])
                    except:
                        tms = ts * 1000

                    if bid > 0 and ask > 0:
                        mid, vol, pc, side = vc.calc(symbol, bid, ask)
                        result.append({
                            'symbol': symbol,
                            'price': round(mid, config['dig']),
                            'bid': round(bid, config['dig']),
                            'ask': round(ask, config['dig']),
                            'volume_synthetic': round(vol, 2),
                            'side': side,
                            'timestamp': tms,
                            'source': 'mt5_history'
                        })
                except:
                    continue

            logger.info(f"[HIST] ✅ {len(result)} ticks")
            return result

        except Exception as e:
            logger.error(f"[HIST] Erro: {e}")
            return []

# ==========================================
# WEBSOCKET MANAGER
# ==========================================

class WebSocketManager:
    def __init__(self):
        self.connections: List[WebSocket] = []
        self.vc = VolumeCalculator()
        self.sim_task = None
        self.mt5_task = None
        self.mt5: Optional[MT5Connector] = None
        self.mode = "simulation"
        self.symbol = "EURUSD"

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)
        logger.info(f"👤 Cliente conectado. Total: {len(self.connections)}")

        await ws.send_json({
            'type': 'connected',
            'data': {
                'mode': self.mode,
                'symbol': self.symbol,
                'mt5_available': MT5_AVAILABLE,
                'mt5_connected': self.mt5.connected if self.mt5 else False
            }
        })

    def disconnect(self, ws: WebSocket):
        if ws in self.connections:
            self.connections.remove(ws)
        logger.info(f"👤 Cliente desconectado. Total: {len(self.connections)}")

    async def broadcast(self, msg: dict):
        bad = []
        for conn in self.connections:
            try:
                await conn.send_json(msg)
            except:
                bad.append(conn)
        for conn in bad:
            self.disconnect(conn)

    async def simulate(self):
        prices = {s: c['base'] for s, c in SYM_CFG.items()}
        n = 0

        while True:
            try:
                if self.mode != "simulation":
                    await asyncio.sleep(1)
                    continue

                n += 1
                s = self.symbol
                bp = prices.get(s, 1.0)

                nf = bp * 0.00005
                bp += math.sin(n/300) * nf * 0.3 + (random.random() - 0.5) * nf
                prices[s] = bp

                sp = bp * 0.00008
                bid, ask = bp - sp/2, bp + sp/2

                mid, vol, pc, side = self.vc.calc(s, bid, ask)
                config = gcfg(s)

                td = TickData(
                    symbol=s,
                    price=round(mid, config['dig']),
                    bid=round(bid, config['dig']),
                    ask=round(ask, config['dig']),
                    volume_synthetic=round(vol, 2),
                    side=side,
                    timestamp=int(datetime.now().timestamp() * 1000),
                    price_change=round(pc, config['dig']),
                    spread=round(sp, config['dig']),
                    source="simulation"
                )

                await self.broadcast({'type': 'tick', 'data': td.to_dict()})
                await asyncio.sleep(0.05 + random.random() * 0.15)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"❌ Sim: {e}")
                await asyncio.sleep(1)

    async def start_mt5(self, symbol: str = "EURUSD") -> bool:
        self.symbol = symbol.upper()
        self.mt5 = MT5Connector()

        async def on_tick(td):
            await self.broadcast({'type': 'tick', 'data': td.to_dict()})

        self.mt5.on_tick = on_tick

        if self.mt5.init():
            self.mode = "mt5"
            self.mt5_task = asyncio.create_task(self.mt5.listen(symbol))
            return True

        self.mode = "simulation"
        return False

    def stop_mt5(self):
        if self.mt5:
            self.mt5.shutdown()
            self.mt5 = None
        if self.mt5_task:
            self.mt5_task.cancel()
            self.mt5_task = None
        self.mode = "simulation"

manager = WebSocketManager()

# ==========================================
# FASTAPI
# ==========================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    manager.sim_task = asyncio.create_task(manager.simulate())
    asyncio.create_task(manager.start_mt5("EURUSD"))

    print("\n" + "=" * 60)
    print("  🚀 MT5 Bridge Server v6.1")
    print("=" * 60 + "\n")

    yield

    manager.stop_mt5()
    if manager.sim_task:
        manager.sim_task.cancel()

app = FastAPI(title="MT5 Bridge", version="6.1", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.get("/")
async def root():
    return {
        "version": "6.1",
        "mode": manager.mode,
        "symbol": manager.symbol,
        "mt5_available": MT5_AVAILABLE,
        "mt5_connected": manager.mt5.connected if manager.mt5 else False,
        "clients": len(manager.connections)
    }

@app.get("/health")
async def health():
    return {
        "status": "online",
        "mode": manager.mode,
        "symbol": manager.symbol,
        "mt5_connected": manager.mt5.connected if manager.mt5 else False,
        "tick_count": manager.mt5.tick_count if manager.mt5 else 0
    }

@app.get("/history/{symbol}")
async def get_history(symbol: str, hours: float = Query(default=1.0, ge=0.1, le=24)):
    if not manager.mt5 or not manager.mt5.connected:
        return {"error": "MT5 não conectado", "ticks": [], "count": 0}

    ticks = manager.mt5.get_history(symbol.upper(), hours)
    return {"symbol": symbol.upper(), "hours": hours, "count": len(ticks), "ticks": ticks}

@app.get("/symbols")
async def list_symbols():
    if not MT5_AVAILABLE or not manager.mt5 or not manager.mt5.connected:
        return {"symbols": [{"name": s} for s in SYM_CFG.keys()]}
    try:
        syms = mt5.symbols_get()
        return {"symbols": [{"name": s.name, "visible": s.visible} for s in syms[:100]]}
    except:
        return {"symbols": []}

@app.post("/switch_symbol/{symbol}")
async def switch_symbol(symbol: str):
    logger.info(f"🔄 Switch: {symbol}")
    manager.symbol = symbol.upper()
    manager.vc.reset(symbol.upper())

    if manager.mode == "mt5":
        manager.stop_mt5()
        ok = await manager.start_mt5(manager.symbol)
        return {"success": ok, "mode": manager.mode, "symbol": manager.symbol}

    return {"success": True, "mode": "simulation", "symbol": manager.symbol}

@app.post("/reconnect")
async def reconnect():
    logger.info("🔄 Reconectando...")
    if manager.mt5:
        manager.stop_mt5()
    ok = await manager.start_mt5(manager.symbol)
    return {"success": ok, "mode": manager.mode}

@app.websocket("/ws")
async def ws_ep(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            data = await ws.receive_text()
            try:
                cmd = json.loads(data)
                if cmd.get('action') == 'switch_symbol':
                    await switch_symbol(cmd.get('symbol', 'EURUSD'))
                elif cmd.get('action') == 'ping':
                    await ws.send_json({'type': 'pong'})
            except:
                pass
    except WebSocketDisconnect:
        manager.disconnect(ws)

# ==========================================
# ENTRY POINT
# ==========================================

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  MT5 Bridge Server v6.1 - Exness")
    print("=" * 60)
    print()
    print("  ⚠️  CONFIGURE SUA SENHA no arquivo!")
    print("      MT5_CONFIG['password'] = 'sua_senha'")
    print()
    print("  ✅ Certifique-se que:")
    print("      1. MT5 está INSTALADO")
    print("      2. MT5 está ABERTO")
    print("      3. MT5 está LOGADO na conta Exness")
    print()
    print("=" * 60 + "\n")

    uvicorn.run(app, host="0.0.0.0", port=8000)
