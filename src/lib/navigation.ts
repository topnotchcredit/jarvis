/**
 * The eighteen areas of the application. `live` areas read real data today. `planned`
 * areas are listed with what they will show and what they are waiting on, so the
 * interface never implies a capability that has not been built and verified.
 */
export type Section = {
  slug: string; // "" is the overview at "/"
  title: string;
  status: "live" | "planned";
  milestone: 1 | 2 | 3 | 4 | 5 | 6;
  summary: string;
  /** What must be connected or recorded before this area has anything to show. */
  dataSource: string;
};

export type SectionGroup = { label: string; sections: Section[] };

export const NAVIGATION: SectionGroup[] = [
  {
    label: "Command",
    sections: [
      { slug: "", title: "Executive overview", status: "live", milestone: 1, summary: "Where every brand stands and what needs a decision.", dataSource: "Organization, brands, stores and the audit log." },
      { slug: "approvals", title: "Approvals and action queue", status: "planned", milestone: 4, summary: "Every action an agent wants to take that needs your sign-off, with its value, reason and expiry.", dataSource: "The action queue. The policy engine and approval rules exist in the database; the queue screen and executor are not built yet." },
      { slug: "activity", title: "Activity and audit logs", status: "live", milestone: 1, summary: "Who changed what, and when.", dataSource: "The append-only audit log." },
    ],
  },
  {
    label: "Brands",
    sections: [
      { slug: "brands", title: "Brands and stores", status: "live", milestone: 1, summary: "The brands you run and the Shopify stores attached to them.", dataSource: "Brands you create here. Stores appear once a Shopify store is connected." },
      { slug: "research", title: "Product research", status: "planned", milestone: 3, summary: "Candidate products scored on demand, competition and margin, with the evidence behind each score.", dataSource: "Research runs with cited sources. Research signals are kept separate from verified sales." },
      { slug: "suppliers", title: "Supplier intelligence", status: "planned", milestone: 3, summary: "Supplier quotes compared on landed cost, minimum order, lead time and reliability.", dataSource: "Supplier quotes you record. Each is marked verified, estimate or assumption." },
      { slug: "catalog", title: "Product catalog", status: "planned", milestone: 2, summary: "Products, variants, prices and unit costs across every store.", dataSource: "Product sync from a connected Shopify store." },
      { slug: "launch", title: "Store launch manager", status: "planned", milestone: 3, summary: "A launch checklist per store with owners, deadlines and a readiness report.", dataSource: "A connected store and a launch brief." },
    ],
  },
  {
    label: "Operations",
    sections: [
      { slug: "orders", title: "Orders and fulfillment", status: "planned", milestone: 2, summary: "Orders, refunds and fulfillment exceptions.", dataSource: "Order sync and webhooks from a connected Shopify store." },
      { slug: "inventory", title: "Inventory", status: "planned", milestone: 2, summary: "Stock by variant and location, with low-stock warnings.", dataSource: "Inventory sync from a connected Shopify store." },
      { slug: "customers", title: "Customers and retention", status: "planned", milestone: 5, summary: "Repeat purchase rate, segments and retention workflows.", dataSource: "Order history, plus marketing consent and suppression lists." },
    ],
  },
  {
    label: "Growth",
    sections: [
      { slug: "marketing", title: "Marketing and campaigns", status: "planned", milestone: 5, summary: "Campaign plans, creative briefs and spend against results.", dataSource: "Connected ad accounts or spend you record. No paid campaign launches without your approval." },
      { slug: "experiments", title: "Experiments and optimization", status: "planned", milestone: 5, summary: "Conversion tests with a hypothesis, a primary metric and a recorded result.", dataSource: "Experiments you define and their measured outcomes." },
    ],
  },
  {
    label: "Money",
    sections: [
      { slug: "finance", title: "Financial performance", status: "planned", milestone: 3, summary: "Revenue, costs, contribution profit and cash needs, with every formula shown.", dataSource: "Synced orders plus product, shipping, fee and ad costs. Figures are labelled partial when any cost is missing." },
    ],
  },
  {
    label: "Automation",
    sections: [
      { slug: "agents", title: "AI agents and runs", status: "planned", milestone: 4, summary: "Every agent run with its task, model, duration, token use and cost.", dataSource: "An Anthropic API key and the agent orchestrator." },
      { slug: "workflows", title: "Automation workflows", status: "planned", milestone: 4, summary: "Scheduled and triggered workflows, their runs and failures.", dataSource: "The background job system." },
    ],
  },
  {
    label: "System",
    sections: [
      { slug: "integrations", title: "Integrations", status: "planned", milestone: 2, summary: "Connection status and health for Shopify, the AI provider and marketing channels.", dataSource: "Store connection flow and health checks." },
      { slug: "settings", title: "Settings, permissions and budgets", status: "live", milestone: 1, summary: "People, roles and the switch that stops autonomous actions.", dataSource: "Organization members and settings. Budget limits are stored but have no editing screen yet." },
    ],
  },
];

export const ALL_SECTIONS: Section[] = NAVIGATION.flatMap((group) => group.sections);
export const PLANNED_SECTIONS: Section[] = ALL_SECTIONS.filter((section) => section.status === "planned");

export const MILESTONES: Record<Section["milestone"], string> = {
  1: "Foundation",
  2: "Shopify connection and sync",
  3: "Finance, research and launch",
  4: "AI agents and approvals",
  5: "Marketing and retention",
  6: "Production hardening",
};
