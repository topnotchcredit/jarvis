import { ratioBps } from "@/lib/money";

/**
 * Period profitability from order-level facts. All amounts are integer minor units in one
 * currency. Formulas are documented in docs/METRICS.md.
 *
 * Unknown inputs are `null`, never zero. When an input is unknown the affected results are
 * still computed from what is known, and the summary is labelled `partial` with the
 * missing inputs named, so a partial figure can never be mistaken for a final one.
 */
export type OrderLine = {
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number; // total discount allocated to this line
  unitCostMinor: number | null; // cost snapshot at order time; null = unknown
};

export type OrderFacts = {
  id: string;
  currency: string;
  cancelled: boolean;
  lines: OrderLine[];
  shippingChargedMinor: number;
  taxMinor: number;
  refundedMinor: number;
  /** Total reported by Shopify for the order; used for reconciliation only. */
  reportedTotalMinor: number;
};

export type PeriodCosts = {
  fulfillmentCostMinor: number | null; // what the business paid to ship and fulfil
  paymentAndPlatformFeesMinor: number | null;
  adSpendMinor: number | null;
  fixedExpensesMinor: number | null;
  newCustomers: number | null;
};

export type MissingInput =
  | "product_costs"
  | "fulfillment_costs"
  | "payment_and_platform_fees"
  | "ad_spend"
  | "fixed_expenses"
  | "new_customer_count";

export type PeriodSummary = {
  currency: string;
  orderCount: number;
  grossSalesMinor: number;
  discountsMinor: number;
  refundsMinor: number;
  netSalesMinor: number;
  shippingChargedMinor: number;
  netRevenueMinor: number;
  taxCollectedMinor: number;
  cogsKnownMinor: number;
  linesMissingCost: number;
  grossProfitMinor: number;
  contributionProfitMinor: number;
  contributionMarginBps: number | null;
  estimatedOperatingProfitMinor: number | null;
  averageOrderValueMinor: number | null;
  marketingEfficiencyRatioBps: number | null;
  customerAcquisitionCostMinor: number | null;
  breakEvenAcquisitionCostMinor: number | null;
  completeness: "complete" | "partial";
  missingInputs: MissingInput[];
  reconciliation: { orderId: string; expectedTotalMinor: number; reportedTotalMinor: number }[];
};

export class MixedCurrencyError extends Error {}

export function summarizePeriod(orders: readonly OrderFacts[], costs: PeriodCosts, currency: string): PeriodSummary {
  const missing = new Set<MissingInput>();
  let grossSales = 0, discounts = 0, refunds = 0, shippingCharged = 0, tax = 0, cogsKnown = 0, linesMissingCost = 0, orderCount = 0;
  const reconciliation: PeriodSummary["reconciliation"] = [];

  for (const order of orders) {
    if (order.currency !== currency) {
      throw new MixedCurrencyError(`Order ${order.id} is in ${order.currency}; summary is in ${currency}`);
    }
    // Cancelled orders contribute nothing. Their refunds reverse sales that are also excluded.
    if (order.cancelled) continue;
    orderCount += 1;
    let orderGross = 0, orderDiscounts = 0;
    for (const line of order.lines) {
      orderGross += line.unitPriceMinor * line.quantity;
      orderDiscounts += line.discountMinor;
      if (line.unitCostMinor === null) {
        linesMissingCost += 1;
        missing.add("product_costs");
      } else {
        cogsKnown += line.unitCostMinor * line.quantity;
      }
    }
    grossSales += orderGross;
    discounts += orderDiscounts;
    refunds += order.refundedMinor;
    shippingCharged += order.shippingChargedMinor;
    tax += order.taxMinor;

    // Each component is counted exactly once; taxes are a pass-through and excluded from revenue.
    const expectedTotal = orderGross - orderDiscounts + order.shippingChargedMinor + order.taxMinor;
    if (expectedTotal !== order.reportedTotalMinor) {
      reconciliation.push({ orderId: order.id, expectedTotalMinor: expectedTotal, reportedTotalMinor: order.reportedTotalMinor });
    }
  }

  if (costs.fulfillmentCostMinor === null) missing.add("fulfillment_costs");
  if (costs.paymentAndPlatformFeesMinor === null) missing.add("payment_and_platform_fees");
  if (costs.adSpendMinor === null) missing.add("ad_spend");
  if (costs.fixedExpensesMinor === null) missing.add("fixed_expenses");
  if (costs.newCustomers === null) missing.add("new_customer_count");

  const netSales = grossSales - discounts - refunds;
  const netRevenue = netSales + shippingCharged;
  const grossProfit = netRevenue - cogsKnown;
  const contributionBeforeAds = grossProfit - (costs.fulfillmentCostMinor ?? 0) - (costs.paymentAndPlatformFeesMinor ?? 0);
  const contributionProfit = contributionBeforeAds - (costs.adSpendMinor ?? 0);

  return {
    currency,
    orderCount,
    grossSalesMinor: grossSales,
    discountsMinor: discounts,
    refundsMinor: refunds,
    netSalesMinor: netSales,
    shippingChargedMinor: shippingCharged,
    netRevenueMinor: netRevenue,
    taxCollectedMinor: tax,
    cogsKnownMinor: cogsKnown,
    linesMissingCost,
    grossProfitMinor: grossProfit,
    contributionProfitMinor: contributionProfit,
    contributionMarginBps: ratioBps(contributionProfit, netRevenue),
    // Operating profit is only stated when fixed expenses are known.
    estimatedOperatingProfitMinor: costs.fixedExpensesMinor === null ? null : contributionProfit - costs.fixedExpensesMinor,
    averageOrderValueMinor: orderCount === 0 ? null : Math.round((grossSales - discounts) / orderCount),
    marketingEfficiencyRatioBps: costs.adSpendMinor ? ratioBps(netRevenue, costs.adSpendMinor) : null,
    customerAcquisitionCostMinor:
      costs.adSpendMinor !== null && costs.newCustomers ? Math.round(costs.adSpendMinor / costs.newCustomers) : null,
    // The most that can be spent to win one order before it loses money.
    breakEvenAcquisitionCostMinor: orderCount === 0 ? null : Math.round(contributionBeforeAds / orderCount),
    completeness: missing.size === 0 ? "complete" : "partial",
    missingInputs: [...missing].sort(),
    reconciliation,
  };
}

export type LandedCostInput = {
  unitCostMinor: number;
  shippingPerUnitMinor: number | null;
  dutiesPerUnitMinor: number | null;
};

/** Landed cost per unit. Unknown freight or duty makes the result an estimate, not a fact. */
export function landedCost(input: LandedCostInput): { landedCostMinor: number; isComplete: boolean; missing: string[] } {
  const missing: string[] = [];
  if (input.shippingPerUnitMinor === null) missing.push("shipping_per_unit");
  if (input.dutiesPerUnitMinor === null) missing.push("duties_per_unit");
  return {
    landedCostMinor: input.unitCostMinor + (input.shippingPerUnitMinor ?? 0) + (input.dutiesPerUnitMinor ?? 0),
    isComplete: missing.length === 0,
    missing,
  };
}
