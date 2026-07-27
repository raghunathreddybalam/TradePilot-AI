import cron from "node-cron";
import { OrderMode, TradeStatus } from "@prisma/client";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";

/**
 * Market-hours aware jobs (IST).
 * Paper/mock mode runs snapshots regardless of market hours.
 */
export function startScheduler() {
  // Snapshot account every 5 minutes during market hours (Mon–Fri 09:15–15:30 IST ≈ 03:45–10:00 UTC)
  cron.schedule("*/5 * * * *", async () => {
    try {
      const mode = env.TRADING_MODE === "LIVE" ? OrderMode.LIVE : OrderMode.PAPER;
      const openTrades = await prisma.trade.count({
        where: { status: TradeStatus.OPEN, mode },
      });
      const closed = await prisma.trade.findMany({
        where: { status: TradeStatus.CLOSED, mode },
        select: { pnl: true },
      });
      const realizedPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);

      await prisma.accountSnapshot.create({
        data: {
          mode,
          equity: env.PAPER_STARTING_EQUITY + realizedPnl,
          cash: env.PAPER_STARTING_EQUITY + realizedPnl,
          realizedPnl,
          openTrades,
        },
      });
    } catch (err) {
      console.error("[cron] account snapshot failed", err);
    }
  });

  console.log("[cron] Scheduler started");
}
