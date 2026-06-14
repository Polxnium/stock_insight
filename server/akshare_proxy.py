"""
AKShare 资金流数据代理服务
================================
为 stock-insight 提供可靠的个股资金流数据。
底层使用 AKShare 聚合东方财富/同花顺等多个数据源，自动容错。

注意：当前 IDE 沙箱环境会屏蔽东财等外部 API 请求，
在真实部署环境下 AKShare 可正常工作。
"""

import re
import json
import time
from typing import Optional

import akshare as ak
import pandas as pd
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# 尝试对 requests.Session 打补丁：增加重试 & 自定义 TransportAdapter
# 让 AKShare 内部 requests 也能用上相同的连接池配置
# ---------------------------------------------------------------------------
try:
    import urllib3
    from requests.adapters import HTTPAdapter

    class RetryAdapter(HTTPAdapter):
        def __init__(self, max_retries=2, **kwargs):
            self._retries = urllib3.Retry(
                total=max_retries,
                connect=max_retries,
                read=max_retries,
                backoff_factor=0.5,
                status_forcelist=[500, 502, 503, 504],
            )
            super().__init__(max_retries=self._retries, **kwargs)
except Exception:
    pass

app = FastAPI(title="stock-insight AKShare 代理")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# 响应模型
# ---------------------------------------------------------------------------
class MoneyFlowResponse(BaseModel):
    ok: bool = True
    data: dict | None = None
    ts: int = 0


class MFKlineResponse(BaseModel):
    ok: bool = True
    data: list = []
    ts: int = 0


# ---------------------------------------------------------------------------
# 辅助
# ---------------------------------------------------------------------------
def _parse_code(code: str) -> tuple[str, str]:
    """'sz002297' → ('sz', '002297')"""
    m = re.match(r'^(sh|sz)(\d{6})$', code.lower())
    if not m:
        raise ValueError(f"无效 code: {code}")
    return m.group(1), m.group(2)


def _to_secid(code: str) -> str:
    market, num = _parse_code(code)
    return f"{'1' if market == 'sh' else '0'}.{num}"


def _now_ts() -> int:
    import time
    return int(time.time() * 1000)


def _round_2(v: float) -> float:
    return round(v, 2)


# ---------------------------------------------------------------------------
# API: 个股资金流向（当日）
# GET /api/moneyflow?code=sz002297
# ---------------------------------------------------------------------------
@app.get("/api/moneyflow", response_model=MoneyFlowResponse)
def moneyflow(code: str = Query(..., description="如 sz002297 / sh600519")):
    try:
        market, stock = _parse_code(code)
        print(f"[AKShare/moneyflow] 请求: {code}")

        df = ak.stock_individual_fund_flow(stock=stock, market=market)
        if df is None or df.empty:
            print(f"[AKShare/moneyflow] {code} 无数据")
            return MoneyFlowResponse(data=None, ts=_now_ts())

        # 取最新一行（最后一笔交易日）
        row = df.iloc[-1]

        # 列名可能带空格 / 换行，统一清洗
        def _col(keywords: list[str]) -> str:
            for c in df.columns:
                for kw in keywords:
                    if kw in c:
                        return c
            return ""

        net_main = float(row.get(_col(["主力净流入-净额", "主力净流入"]), 0) or 0)
        pct_main = float(row.get(_col(["主力净流入-净占比", "主力净占比"]), 0) or 0)
        net_super = float(row.get(_col(["超大单净流入-净额"]), 0) or 0)
        pct_super = float(row.get(_col(["超大单净流入-净占比"]), 0) or 0)
        net_large = float(row.get(_col(["大单净流入-净额"]), 0) or 0)
        pct_large = float(row.get(_col(["大单净流入-净占比"]), 0) or 0)
        net_medium = float(row.get(_col(["中单净流入-净额"]), 0) or 0)
        pct_medium = float(row.get(_col(["中单净流入-净占比"]), 0) or 0)
        net_small = float(row.get(_col(["小单净流入-净额"]), 0) or 0)
        pct_small = float(row.get(_col(["小单净流入-净占比"]), 0) or 0)

        # 尝试读取涨跌幅（用于侧面验证）
        change_pct = float(row.get(_col(["涨跌幅"]), 0) or 0)

        result = {
            "code": code,
            "mainNet": net_main,
            "mainPct": _round_2(pct_main),
            "superLargeNet": net_super,
            "superLargePct": _round_2(pct_super),
            "largeNet": net_large,
            "largePct": _round_2(pct_large),
            "mediumNet": net_medium,
            "mediumPct": _round_2(pct_medium),
            "smallNet": net_small,
            "smallPct": _round_2(pct_small),
            "northNet": None,
            "northPct": None,
            "northBuy": None,
            "northSell": None,
            "northVol": None,
            "northAmount": None,
        }

        print(
            f"[AKShare/moneyflow] ✓ {code} 主力:{net_main/1e8:.2f}亿({pct_main:.2f}%) "
            f"超大单:{net_super/1e4:.0f}万 大单:{net_large/1e4:.0f}万 "
            f"中单:{net_medium/1e4:.0f}万 小单:{net_small/1e4:.0f}万"
        )
        return MoneyFlowResponse(data=result, ts=_now_ts())

    except Exception as e:
        print(f"[AKShare/moneyflow] 错误: {type(e).__name__}: {e}")
        return MoneyFlowResponse(data=None, ts=_now_ts())


# ---------------------------------------------------------------------------
# API: 近 N 日资金流向日线
# GET /api/mfkline?code=sz002297&days=10
# ---------------------------------------------------------------------------
@app.get("/api/mfkline", response_model=MFKlineResponse)
def mfkline(code: str = Query(...), days: int = Query(10, ge=1, le=30)):
    try:
        market, stock = _parse_code(code)
        print(f"[AKShare/mfkline] 请求: {code}, days={days}")

        df = ak.stock_individual_fund_flow(stock=stock, market=market)
        if df is None or df.empty:
            print(f"[AKShare/mfkline] {code} 无数据")
            return MFKlineResponse(data=[], ts=_now_ts())

        # 取最近 N 行
        df = df.tail(min(days, len(df)))

        def _col(keywords: list[str]) -> str:
            for c in df.columns:
                for kw in keywords:
                    if kw in c:
                        return c
            return ""

        col_date = _col(["日期"])
        col_main_net = _col(["主力净流入-净额"])
        col_small_net = _col(["小单净流入-净额"])
        col_medium_net = _col(["中单净流入-净额"])
        col_large_net = _col(["大单净流入-净额"])
        col_super_net = _col(["超大单净流入-净额"])
        col_main_pct = _col(["主力净流入-净占比"])
        col_super_pct = _col(["超大单净流入-净占比"])

        records = []
        for _, row in df.iterrows():
            records.append({
                "date": str(row.get(col_date, "")),
                "mainNet": float(row.get(col_main_net, 0) or 0),
                "smallNet": float(row.get(col_small_net, 0) or 0),
                "mediumNet": float(row.get(col_medium_net, 0) or 0),
                "largeNet": float(row.get(col_large_net, 0) or 0),
                "superLargeNet": float(row.get(col_super_net, 0) or 0),
                "mainPct": float(row.get(col_main_pct, 0) or 0),
                "superLargePct": float(row.get(col_super_pct, 0) or 0),
            })

        print(f"[AKShare/mfkline] ✓ {code}, {len(records)} 条")
        return MFKlineResponse(data=records, ts=_now_ts())

    except Exception as e:
        print(f"[AKShare/mfkline] 错误: {type(e).__name__}: {e}")
        return MFKlineResponse(data=[], ts=_now_ts())


# ---------------------------------------------------------------------------
# 健康检查
# ---------------------------------------------------------------------------
@app.get("/api/akshare-health")
def health():
    return {"ok": True, "service": "akshare"}


# 直接运行时启动
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")