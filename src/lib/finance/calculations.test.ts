import { describe, expect, it } from "vitest";
import { landedCost, MixedCurrencyError, summarizePeriod, type OrderFacts, type PeriodCosts } from "./calculations";

// Worked example, verified by hand (see docs/METRICS.md, "Worked example"):
//   O1: 2 x $25.00 (cost $7.00 each), $5.00 discount, $4.99 shipping, $3.60 tax  -> total $53.59
//   O2: 1 x $40.00 (cost $12.00) + 1 x $15.00 (cost $4.00), $4.40 tax, $15.00 refunded -> total $59.40
//   O3: cancelled, ignored
const orders: OrderFacts[] = [
  {
    id: "O1", currency: "USD", cancelled: false, shippingChargedMinor: 499, taxMinor: 360, refundedMinor: 0, reportedTotalMinor: 5359,
    lines: [{ quantity: 2, unitPriceMinor: 2500, discountMinor: 500, unitCostMinor: 700 }],
  },
  {
    id: "O2", currency: "USD", cancelled: false, shippingChargedMinor: 0, taxMinor: 440, refundedMinor: 1500, reportedTotalMinor: 5940,
    lines: [
      { quantity: 1, unitPriceMinor: 4000, discountMinor: 0, unitCostMinor: 1200 },
      { quantity: 1, unitPriceMinor: 1500, discountMinor: 0, unitCostMinor: 400 },
    ],
  },
  {
    id: "O3", currency: "USD", cancelled: true, shippingChargedMinor: 0, taxMinor: 0, refundedMinor: 9900, reportedTotalMinor: 9900,
    lines: [{ quantity: 1, unitPriceMinor: 9900, discountMinor: 0, unitCostMinor: 3000 }],
  },
];
const costs: PeriodCosts = { fulfillmentCostMinor: 900, paymentAndPlatformFeesMinor: 310, adSpendMinor: 2000, fixedExpensesMinor: 1000, newCustomers: 2 };

describe("summarizePeriod", () => {
  it("matches the hand-verified example (acceptance criterion 10)", () => {
    const s = summarizePeriod(orders, costs, "USD");
    expect(s).toMatchObject({
      orderCount: 2,
      grossSalesMinor: 10500,
      discountsMinor: 500,
      refundsMinor: 1500,
      netSalesMinor: 8500,
      shippingChargedMinor: 499,
      netRevenueMinor: 8999,
      taxCollectedMinor: 800,
      cogsKnownMinor: 3000,
      grossProfitMinor: 5999,
      contributionProfitMinor: 2789,
      contributionMarginBps: 3099,
      estimatedOperatingProfitMinor: 1789,
      averageOrderValueMinor: 5000,
      marketingEfficiencyRatioBps: 44995,
      customerAcquisitionCostMinor: 1000,
      breakEvenAcquisitionCostMinor: 2395,
      completeness: "complete",
      missingInputs: [],
      reconciliation: [],
    });
  });

  it("keeps revenue, gross profit, contribution profit and operating profit distinct", () => {
    const s = summarizePeriod(orders, costs, "USD");
    const values = [s.netRevenueMinor, s.grossProfitMinor, s.contributionProfitMinor, s.estimatedOperatingProfitMinor];
    expect(new Set(values).size).toBe(4);
  });

  it("does not count tax as revenue", () => {
    const s = summarizePeriod(orders, costs, "USD");
    expect(s.netRevenueMinor + s.taxCollectedMinor).toBe(9799);
    expect(s.netRevenueMinor).toBe(8999);
  });

  it("flags a missing product cost instead of treating it as zero (acceptance criterion 9)", () => {
    const withUnknown = structuredClone(orders);
    withUnknown[1].lines[0].unitCostMinor = null;
    const s = summarizePeriod(withUnknown, costs, "USD");
    expect(s.completeness).toBe("partial");
    expect(s.missingInputs).toEqual(["product_costs"]);
    expect(s.linesMissingCost).toBe(1);
    expect(s.cogsKnownMinor).toBe(1800); // only the costs that are actually known
  });

  it("names every missing period cost and withholds figures that depend on it", () => {
    const s = summarizePeriod(orders, { fulfillmentCostMinor: null, paymentAndPlatformFeesMinor: null, adSpendMinor: null, fixedExpensesMinor: null, newCustomers: null }, "USD");
    expect(s.completeness).toBe("partial");
    expect(s.missingInputs).toEqual(["ad_spend", "fixed_expenses", "fulfillment_costs", "new_customer_count", "payment_and_platform_fees"]);
    expect(s.estimatedOperatingProfitMinor).toBeNull();
    expect(s.marketingEfficiencyRatioBps).toBeNull();
    expect(s.customerAcquisitionCostMinor).toBeNull();
  });

  it("reports orders whose components do not add up to the Shopify total", () => {
    const off = structuredClone(orders);
    off[0].reportedTotalMinor = 5400;
    expect(summarizePeriod(off, costs, "USD").reconciliation).toEqual([{ orderId: "O1", expectedTotalMinor: 5359, reportedTotalMinor: 5400 }]);
  });

  it("returns nulls, not NaN or Infinity, for an empty period", () => {
    const s = summarizePeriod([], { ...costs, adSpendMinor: 0, newCustomers: 0 }, "USD");
    expect(s.contributionMarginBps).toBeNull();
    expect(s.averageOrderValueMinor).toBeNull();
    expect(s.marketingEfficiencyRatioBps).toBeNull();
    expect(s.customerAcquisitionCostMinor).toBeNull();
    expect(s.breakEvenAcquisitionCostMinor).toBeNull();
  });

  it("refuses to add orders in different currencies", () => {
    const mixed = structuredClone(orders);
    mixed[0].currency = "CAD";
    expect(() => summarizePeriod(mixed, costs, "USD")).toThrow(MixedCurrencyError);
  });
});

describe("landedCost", () => {
  it("adds unit cost, freight and duty", () => {
    expect(landedCost({ unitCostMinor: 420, shippingPerUnitMinor: 85, dutiesPerUnitMinor: 31 })).toEqual({ landedCostMinor: 536, isComplete: true, missing: [] });
  });
  it("marks the result incomplete when freight or duty is unknown", () => {
    expect(landedCost({ unitCostMinor: 420, shippingPerUnitMinor: null, dutiesPerUnitMinor: 31 })).toEqual({ landedCostMinor: 451, isComplete: false, missing: ["shipping_per_unit"] });
  });
});
