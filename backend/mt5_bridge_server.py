# mt5_bridge_server.py v5.1
# PARE O SERVIDOR ANTIGO (Ctrl+C) E RODE ESTE!
# python mt5_bridge_server.py

import asyncio, json, logging, math, random
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, List
from dataclasses import dataclass, asdict
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    MT5_AVAILABLE = False

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

SYM_CFG = {
    'EURUSD': {'mult': 100000.0, 'bv': 5.0, 'dig': 5},
    'GBPUSD': {'mult': 100000.0, 'bv': 5.0, 'dig': 5},
    'USDJPY': {'mult': 1000.0, 'bv': 5.0, 'dig': 3},
    'XAUUSD': {'mult': 50.0, 'bv': 10.0, 'dig': 2},
    'USTEC':  {'mult': 2.0, 'bv': 10.0, 'dig': 2},
    'US100':  {'mult': 2.0, 'bv': 10.0, 'dig': 2},
    'NAS100': {'mult': 2.0, 'bv': 10.0, 'dig': 2},
    'BTCUSD': {'mult': 1.0, 'bv': 5.0, 'dig': 2},
}
def gcfg(s): return SYM_CFG.get(s.upper(), {'mult': 1000.0, 'bv': 5.0, 'dig': 5})

@dataclass
class TD:
    symbol: str; price: float; bid: float; ask: float
    volume_synthetic: float; side: str; timestamp: int
    price_change: float; spread: float; source: str = "simulation"
    def to_dict(self): return asdict(self)

class VC:
    def __init__(self): self.lb: Dict[str,float] = {}; self.lm: Dict[str,float] = {}
    def calc(self, sym, bid, ask):
        c = gcfg(sym); mid = (bid+ask)/2
        lb = self.lb.get(sym, bid); lm = self.lm.get(sym, mid)
        pc = mid - lm; bc = bid - lb
        vol = abs(pc)*c['mult'] + c['bv']
        vol *= (0.7 + random.random()*0.6); vol = max(vol, c['bv'])
        side = 'buy' if bc > 0 else ('sell' if bc < 0 else ('buy' if random.random()>0.5 else 'sell'))
        self.lb[sym] = bid; self.lm[sym] = mid
        return mid, vol, pc, side
    def reset(self, sym=None):
        if sym: self.lb.pop(sym,None); self.lm.pop(sym,None)
        else: self.lb.clear(); self.lm.clear()

class MT5C:
    def __init__(self): self.connected = False; self.vc = VC(); self.on_tick = None; self.tc = 0
    def init(self):
        if not MT5_AVAILABLE: return False
        try:
            if not mt5.initialize(): logger.error("MT5 init fail"); return False
            self.connected = True
            a = mt5.account_info()
            if a: logger.info(f"MT5: {a.login} @ {a.server}")
            return True
        except Exception as e: logger.error(f"MT5: {e}"); return False
    def shutdown(self):
        if self.connected: mt5.shutdown(); self.connected = False

    async def listen(self, sym="EURUSD"):
        if not self.connected: return
        if not mt5.symbol_select(sym, True): logger.error(f"{sym} indisponível"); return
        logger.info(f"Ouvindo {sym}..."); lt = 0
        while self.connected:
            try:
                tk = mt5.symbol_info_tick(sym)
                if tk and (tk.time != lt or self.tc == 0):
                    lt = tk.time; self.tc += 1
                    if tk.bid <= 0 or tk.ask <= 0: continue
                    mid, vol, pc, side = self.vc.calc(sym, tk.bid, tk.ask)
                    c = gcfg(sym)
                    td = TD(symbol=sym, price=round(mid,c['dig']), bid=round(tk.bid,c['dig']),
                        ask=round(tk.ask,c['dig']), volume_synthetic=round(vol,2), side=side,
                        timestamp=int(datetime.now().timestamp()*1000),
                        price_change=round(pc,c['dig']), spread=round(tk.ask-tk.bid,c['dig']), source="mt5")
                    if self.tc % 200 == 0: logger.info(f"Tick #{self.tc}: {sym} bid={tk.bid} mid={mid:.{c['dig']}f} vol={vol:.1f} {side}")
                    if self.on_tick: await self.on_tick(td)
                await asyncio.sleep(0.05)
            except Exception as e: logger.error(f"Tick: {e}"); await asyncio.sleep(1)

    def get_history(self, sym: str, hours: float) -> List[dict]:
        if not self.connected or not MT5_AVAILABLE:
            logger.error("[HIST] MT5 não conectado"); return []
        if not mt5.symbol_select(sym, True):
            logger.error(f"[HIST] {sym} indisponível"); return []
        utc_to = datetime.now(timezone.utc)
        utc_from = utc_to - timedelta(hours=hours)
        logger.info(f"[HIST] {sym}: {hours}h ({utc_from.strftime('%H:%M')} → {utc_to.strftime('%H:%M')} UTC)")
        try:
            raw = mt5.copy_ticks_range(sym, utc_from, utc_to, mt5.COPY_TICKS_ALL)
            if raw is None or len(raw) == 0:
                logger.info("[HIST] copy_ticks_range vazio, fallback copy_ticks_from...")
                raw = mt5.copy_ticks_from(sym, utc_from, 500000, mt5.COPY_TICKS_ALL)
            if raw is None or len(raw) == 0:
                logger.error(f"[HIST] Sem ticks. err={mt5.last_error()}"); return []
            n = len(raw)
            logger.info(f"[HIST] {n} ticks brutos")
            try: logger.info(f"[HIST] Campos: {raw.dtype.names}")
            except: pass
            try: logger.info(f"[HIST] 1o: bid={raw[0]['bid']} ask={raw[0]['ask']} time={raw[0]['time']}")
            except: pass
            vc = VC(); c = gcfg(sym); result = []
            for i in range(n):
                try:
                    t = raw[i]; bid = float(t['bid']); ask = float(t['ask']); ts = int(t['time'])
                    try: tms = int(t['time_msc'])
                    except: tms = ts * 1000
                except:
                    try: bid = float(t[1]); ask = float(t[2]); ts = int(t[0]); tms = ts*1000
                    except: continue
                if bid <= 0 or ask <= 0: continue
                mid, vol, pc, side = vc.calc(sym, bid, ask)
                result.append({'symbol':sym,'price':round(mid,c['dig']),'bid':round(bid,c['dig']),'ask':round(ask,c['dig']),
                    'volume_synthetic':round(vol,2),'side':side,'timestamp':tms,
                    'price_change':round(pc,c['dig']),'spread':round(ask-bid,c['dig']),'source':'mt5_history'})
            logger.info(f"[HIST] ✅ {len(result)} ticks processados")
            return result
        except Exception as e:
            logger.error(f"[HIST] Erro: {e}"); import traceback; traceback.print_exc(); return []

class WM:
    def __init__(self):
        self.conns: list[WebSocket] = []; self.vc = VC()
        self.sim_task = None; self.mt5_task = None
        self.mt5: Optional[MT5C] = None; self.mode = "simulation"; self.sym = "EURUSD"
    async def conn(self, ws): await ws.accept(); self.conns.append(ws)
    def disc(self, ws):
        if ws in self.conns: self.conns.remove(ws)
    async def bcast(self, msg):
        bad = []
        for c in self.conns:
            try: await c.send_json(msg)
            except: bad.append(c)
        for c in bad: self.disc(c)
    async def simulate(self):
        pr = {'EURUSD':1.085,'XAUUSD':2900.0,'USTEC':21500.0}; n = 0
        while True:
            try:
                if self.mode != "simulation": await asyncio.sleep(1); continue
                n += 1; s = self.sym; bp = pr.get(s, 1.0)
                nf = bp*0.00005; bp += math.sin(n/300)*nf*0.3+(random.random()-0.5)*nf; pr[s] = bp
                sp = bp*0.00008; bid = bp-sp/2; ask = bp+sp/2
                mid, vol, pc, side = self.vc.calc(s, bid, ask)
                if random.random() > 0.95: vol *= 3+random.random()*5
                d = gcfg(s)['dig']
                await self.bcast({'type':'tick','data':TD(symbol=s,price=round(mid,d),bid=round(bid,d),ask=round(ask,d),
                    volume_synthetic=round(vol,2),side=side,timestamp=int(datetime.now().timestamp()*1000),
                    price_change=round(pc,d),spread=round(sp,d),source="simulation").to_dict()})
                await asyncio.sleep(0.05+random.random()*0.15)
            except: await asyncio.sleep(1)
    async def start_mt5(self, sym="EURUSD"):
        self.sym = sym.upper(); self.mt5 = MT5C()
        async def on_tick(td): await self.bcast({'type':'tick','data':td.to_dict()})
        self.mt5.on_tick = on_tick
        if self.mt5.init():
            self.mode = "mt5"; self.mt5_task = asyncio.create_task(self.mt5.listen(sym))
            logger.info(f"MT5 REAL: {sym}"); return True
        self.mode = "simulation"; return False
    def stop_mt5(self):
        if self.mt5: self.mt5.shutdown(); self.mt5 = None
        if self.mt5_task: self.mt5_task.cancel()
        self.mode = "simulation"

mgr = WM()

@asynccontextmanager
async def lifespan(app: FastAPI):
    mgr.sim_task = asyncio.create_task(mgr.simulate())
    asyncio.create_task(mgr.start_mt5("EURUSD"))
    logger.info("🚀 Servidor v5.1 iniciado")
    yield
    mgr.stop_mt5()
    if mgr.sim_task: mgr.sim_task.cancel()

app = FastAPI(title="MT5 Bridge", version="5.1", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.get("/")
async def root():
    return {"v":"5.1","mode":mgr.mode,"symbol":mgr.sym,"mt5":MT5_AVAILABLE,
            "routes":["/","/health","/history/{sym}?hours=N","/symbols","/switch_symbol/{sym}","/ws"]}

@app.get("/health")
async def health():
    return {"status":"online","v":"5.1","mode":mgr.mode,"symbol":mgr.sym,
            "mt5_connected": mgr.mt5.connected if mgr.mt5 else False}

@app.get("/history/{symbol}")
async def get_history(symbol: str, hours: float = Query(default=1.0, ge=0.1, le=24)):
    logger.info(f">>> /history/{symbol}?hours={hours}")
    if not mgr.mt5 or not mgr.mt5.connected:
        return {"error":"MT5 não conectado","ticks":[],"count":0}
    ticks = mgr.mt5.get_history(symbol.upper(), hours)
    logger.info(f"<<< {len(ticks)} ticks")
    return {"symbol":symbol.upper(),"hours":hours,"count":len(ticks),"ticks":ticks}

@app.get("/symbols")
async def symbols(filter: str = ""):
    if not MT5_AVAILABLE or not mgr.mt5 or not mgr.mt5.connected: return {"symbols":[]}
    try:
        ss = mt5.symbols_get()
        return {"symbols":[{"name":s.name,"desc":s.description,"dig":s.digits} for s in ss if not filter or filter.upper() in s.name.upper()][:50]}
    except: return {"symbols":[]}

@app.post("/switch_symbol/{symbol}")
async def switch_sym(symbol: str):
    logger.info(f"Switch: {symbol}"); mgr.sym = symbol.upper(); mgr.vc.reset(symbol.upper())
    if mgr.mode == "mt5":
        mgr.stop_mt5(); ok = await mgr.start_mt5(mgr.sym)
        return {"ok":ok,"mode":mgr.mode,"symbol":mgr.sym}
    return {"ok":True,"mode":"simulation","symbol":mgr.sym}

@app.websocket("/ws")
async def ws_ep(ws: WebSocket):
    await mgr.conn(ws)
    try:
        while True:
            data = await ws.receive_text(); cmd = json.loads(data)
            if cmd.get('action') == 'subscribe': logger.info(f"Sub: {cmd.get('symbol')}")
            elif cmd.get('action') == 'switch_symbol': await switch_sym(cmd.get('symbol','EURUSD'))
    except WebSocketDisconnect: mgr.disc(ws)

if __name__ == "__main__":
    print("\n" + "="*55)
    print("  MT5 Bridge v5.1")
    print("  ROTAS:")
    print("    GET  /history/XAUUSD?hours=2")
    print("    GET  /history/EURUSD?hours=8")
    print("    POST /switch_symbol/USTEC")
    print("    WS   ws://localhost:8000/ws")
    print("="*55 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=8000)
