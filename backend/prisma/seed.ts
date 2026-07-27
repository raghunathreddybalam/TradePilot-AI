import { PrismaClient, InstrumentType } from "@prisma/client";

const prisma = new PrismaClient();

const INSTRUMENTS = [
  { symbol: "NIFTY 50", name: "Nifty 50", instrumentType: InstrumentType.INDEX, lotSize: 25 },
  { symbol: "NIFTY BANK", name: "Nifty Bank", instrumentType: InstrumentType.INDEX, lotSize: 15 },
  { symbol: "RELIANCE", name: "Reliance Industries", instrumentType: InstrumentType.STOCK, lotSize: 1 },
  { symbol: "TCS", name: "Tata Consultancy Services", instrumentType: InstrumentType.STOCK, lotSize: 1 },
  { symbol: "INFY", name: "Infosys", instrumentType: InstrumentType.STOCK, lotSize: 1 },
  { symbol: "HDFCBANK", name: "HDFC Bank", instrumentType: InstrumentType.STOCK, lotSize: 1 },
  { symbol: "SBIN", name: "State Bank of India", instrumentType: InstrumentType.STOCK, lotSize: 1 },
];

async function main() {
  for (const inst of INSTRUMENTS) {
    await prisma.instrument.upsert({
      where: { symbol: inst.symbol },
      create: { ...inst, exchange: "NSE" },
      update: {
        name: inst.name,
        instrumentType: inst.instrumentType,
        lotSize: inst.lotSize,
        isActive: true,
      },
    });
  }
  console.log(`Seeded ${INSTRUMENTS.length} instruments`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
