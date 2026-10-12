# Metric definitions

Every figure JARVIS will display is defined here and computed in `src/lib/finance/calculations.ts`. All amounts are integer minor units in one currency. None of these appear in the interface yet; the financial screens arrive in Milestone 3.

| Metric | Formula | Source |
| --- | --- | --- |
| Gross sales | Σ unit price × quantity | `order_items` |
| Discounts | Σ line discounts | `order_items` |
| Refunds | Σ refund amounts | `refunds` |
| Net sales | Gross sales − discounts − refunds | derived |
| Shipping charged | Σ shipping paid by customers | `orders` |
| Net revenue | Net sales + shipping charged. Tax is a pass-through and excluded. | derived |
| Cost of goods sold | Σ unit cost at order time × quantity, for lines whose cost is known | `order_items.unit_cost_minor` |
| Gross profit | Net revenue − COGS | derived |
| Contribution profit | Gross profit − fulfillment cost − payment and platform fees − ad spend | `expenses`, `campaign_metrics` |
| Contribution margin | Contribution profit ÷ net revenue | derived |
| Estimated operating profit | Contribution profit − fixed expenses. Withheld when fixed expenses are unknown. | `expenses` |
| Average order value | (Gross sales − discounts) ÷ orders | derived |
| Marketing efficiency ratio | Net revenue ÷ ad spend | derived |
| Customer acquisition cost | Ad spend ÷ new customers | derived |
| Break-even acquisition cost | (Gross profit − fulfillment − fees) ÷ orders | derived |
| Landed cost | Unit cost + freight per unit + duty per unit | `supplier_quotes` |

Rules: cancelled orders are excluded. A missing input is never treated as zero; the summary is labelled `partial` and lists what is missing. Revenue, gross profit, contribution profit, operating profit and cash flow are different things and are never substituted for one another; cash flow is not computed yet. Each order's components are checked against Shopify's reported total and mismatches are listed. Known gap: the cost of refunded goods is not reversed.

## Worked example

Used by the unit test, verified by hand.

- Order 1: 2 × $25.00 (cost $7.00 each), $5.00 discount, $4.99 shipping, $3.60 tax. Total $53.59.
- Order 2: 1 × $40.00 (cost $12.00) and 1 × $15.00 (cost $4.00), $4.40 tax, $15.00 refunded. Total $59.40.
- Order 3: cancelled; ignored.
- Period costs: fulfillment $9.00, fees $3.10, ads $20.00, fixed $10.00, 2 new customers.

Gross sales $105.00; discounts $5.00; refunds $15.00; net sales $85.00; net revenue $89.99; tax collected $8.00; COGS $30.00; gross profit $59.99; contribution profit $59.99 − $9.00 − $3.10 − $20.00 = $27.89; contribution margin 30.99%; operating profit $17.89; average order value $50.00; marketing efficiency 4.4995; acquisition cost $10.00; break-even acquisition cost $47.89 ÷ 2 = $23.95.
