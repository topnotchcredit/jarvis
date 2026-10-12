import { describe, expect, it } from "vitest";
import { ACTION_CATALOG, evaluateAction, type ActionRequest, type PolicyContext } from "./engine";

const now = new Date("2026-10-12T12:00:00Z");
const later = new Date("2026-10-12T13:00:00Z");
const earlier = new Date("2026-10-12T11:00:00Z");

const request = (over: Partial<ActionRequest> = {}): ActionRequest => ({
  actionId: "a1",
  actionType: "ads.adjust_existing_campaign_budget",
  actor: { kind: "agent", agentRunId: "run1" },
  valueMinor: 2_000,
  payloadHash: "h1",
  expiresAt: later,
  dryRun: false,
  ...over,
});

const context = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  now,
  autonomyPaused: { organization: false, brand: false, store: false },
  enabledActionTypes: new Set(Object.keys(ACTION_CATALOG)),
  limits: { maxActionValueMinor: 5_000, dailyLimitMinor: 10_000, monthlyLimitMinor: 100_000, maxActionsPerDay: 20 },
  usage: { spentTodayMinor: 0, spentThisMonthMinor: 0, actionsToday: 0 },
  marginFloorBps: 3_000,
  approval: null,
  consecutiveCriticalFailures: 0,
  criticalFailureThreshold: 3,
  ...over,
});

const approval = (over = {}) => ({ actionId: "a1", decision: "approved" as const, decidedByUserId: "u-admin", payloadHash: "h1", expiresAt: later, ...over });

describe("allowlist (acceptance criterion 13)", () => {
  it("blocks an action type that is not in the catalog", () => {
    expect(evaluateAction(request({ actionType: "shell.run" }), context()).outcome).toBe("block");
  });
  it("blocks prototype-chain names that are not real action types", () => {
    for (const actionType of ["constructor", "toString", "__proto__"]) {
      expect(evaluateAction(request({ actionType }), context({ enabledActionTypes: new Set([actionType]) })).outcome, actionType).toBe("block");
    }
  });
  it("blocks a catalog action that is not enabled for this scope", () => {
    expect(evaluateAction(request(), context({ enabledActionTypes: new Set(["report.generate"]) })).outcome).toBe("block");
  });
  it("blocks an expired action", () => {
    expect(evaluateAction(request({ expiresAt: earlier }), context()).outcome).toBe("block");
  });
  it("blocks a negative or non-integer value", () => {
    expect(evaluateAction(request({ valueMinor: -1 }), context()).outcome).toBe("block");
    expect(evaluateAction(request({ valueMinor: 10.5 }), context()).outcome).toBe("block");
  });
});

describe("agents cannot touch the policy system", () => {
  it.each(["permission.grant", "budget.raise_limit", "policy.update", "approval.grant", "credential.rotate", "security.disable_rls", "killswitch.release"])(
    "blocks %s from an agent even with an approval and even if someone enabled it",
    (actionType) => {
      const d = evaluateAction(request({ actionType }), context({ approval: approval(), enabledActionTypes: new Set([actionType]) }));
      expect(d.outcome).toBe("block");
    },
  );
});

describe("automatic tier", () => {
  it("allows read-only work", () => {
    expect(evaluateAction(request({ actionType: "report.generate", valueMinor: null }), context())).toMatchObject({ outcome: "allow", execute: true });
  });
  it("still allows reports while the kill switch is on", () => {
    const d = evaluateAction(request({ actionType: "report.generate", valueMinor: null }), context({ autonomyPaused: { organization: true, brand: false, store: false } }));
    expect(d.outcome).toBe("allow");
  });
});

describe("conditional tier and spending limits (acceptance criterion 14)", () => {
  it("allows spend inside every limit", () => {
    expect(evaluateAction(request(), context())).toMatchObject({ outcome: "allow", execute: true });
  });
  it("allows spend exactly at the limit", () => {
    expect(evaluateAction(request({ valueMinor: 5_000 }), context()).outcome).toBe("allow");
  });
  it("does not execute spend above the single-action maximum", () => {
    const d = evaluateAction(request({ valueMinor: 5_001 }), context());
    expect(d).toMatchObject({ outcome: "require_approval", execute: false });
  });
  it("does not execute spend that would pass the daily limit", () => {
    const d = evaluateAction(request(), context({ usage: { spentTodayMinor: 9_000, spentThisMonthMinor: 9_000, actionsToday: 3 } }));
    expect(d).toMatchObject({ outcome: "require_approval", execute: false });
    expect(d.reasons).toContain("Would exceed the daily spending limit");
  });
  it("does not execute spend that would pass the monthly limit", () => {
    const d = evaluateAction(request(), context({ usage: { spentTodayMinor: 0, spentThisMonthMinor: 99_000, actionsToday: 0 } }));
    expect(d.outcome).toBe("require_approval");
  });
  it("does not execute past the daily action count", () => {
    const d = evaluateAction(request(), context({ usage: { spentTodayMinor: 0, spentThisMonthMinor: 0, actionsToday: 20 } }));
    expect(d.outcome).toBe("require_approval");
  });
  it("requires approval when no limits exist, rather than assuming unlimited", () => {
    expect(evaluateAction(request(), context({ limits: null })).outcome).toBe("require_approval");
    const empty = { maxActionValueMinor: null, dailyLimitMinor: null, monthlyLimitMinor: null, maxActionsPerDay: null };
    expect(evaluateAction(request(), context({ limits: empty })).outcome).toBe("require_approval");
  });
  it("requires approval when the spend amount is unknown", () => {
    expect(evaluateAction(request({ valueMinor: null }), context()).outcome).toBe("require_approval");
  });
  it("lets an authorized approval carry an over-limit action", () => {
    expect(evaluateAction(request({ valueMinor: 8_000 }), context({ approval: approval() })).outcome).toBe("allow");
  });
});

describe("margin floor", () => {
  const price = (resultingMarginBps: number | null) => request({ actionType: "catalog.update_price", valueMinor: null, resultingMarginBps });
  it("allows a price change that keeps margin at or above the floor", () => {
    expect(evaluateAction(price(3_000), context()).outcome).toBe("allow");
  });
  it("requires approval below the floor", () => {
    expect(evaluateAction(price(2_999), context()).outcome).toBe("require_approval");
  });
  it("requires approval when the resulting margin or the floor is unknown", () => {
    expect(evaluateAction(price(null), context()).outcome).toBe("require_approval");
    expect(evaluateAction(price(5_000), context({ marginFloorBps: null })).outcome).toBe("require_approval");
  });
});

describe("approval-required tier (acceptance criteria 15 and 16)", () => {
  const launch = (over: Partial<ActionRequest> = {}) => request({ actionType: "ads.launch_campaign", ...over });
  it("never runs without an approval, however small", () => {
    expect(evaluateAction(launch({ valueMinor: 1 }), context())).toMatchObject({ outcome: "require_approval", execute: false });
  });
  it("runs with a valid approval", () => {
    expect(evaluateAction(launch(), context({ approval: approval() }))).toMatchObject({ outcome: "allow", execute: true });
  });
  it("ignores an expired approval", () => {
    const d = evaluateAction(launch(), context({ approval: approval({ expiresAt: earlier }) }));
    expect(d.outcome).toBe("require_approval");
    expect(d.reasons).toContain("The approval has expired");
  });
  it("ignores an approval that expires at this exact instant", () => {
    expect(evaluateAction(launch(), context({ approval: approval({ expiresAt: now }) })).outcome).toBe("require_approval");
  });
  it("ignores an approval for a different action", () => {
    expect(evaluateAction(launch(), context({ approval: approval({ actionId: "other" }) })).outcome).toBe("require_approval");
  });
  it("ignores an approval when the payload changed after it was given", () => {
    expect(evaluateAction(launch({ payloadHash: "h2" }), context({ approval: approval() })).outcome).toBe("require_approval");
  });
  it("blocks a rejected action", () => {
    expect(evaluateAction(launch(), context({ approval: approval({ decision: "rejected" }) })).outcome).toBe("block");
  });
});

describe("kill switch and automatic shutdown (acceptance criterion 18)", () => {
  it.each(["organization", "brand", "store"] as const)("blocks agent mutations when the %s switch is on, even if approved", (scope) => {
    const paused = { organization: false, brand: false, store: false, [scope]: true };
    expect(evaluateAction(request(), context({ autonomyPaused: paused })).outcome).toBe("block");
    expect(evaluateAction(request({ actionType: "ads.launch_campaign" }), context({ autonomyPaused: paused, approval: approval() })).outcome).toBe("block");
  });
  it("suspends agent mutations after repeated critical failures", () => {
    expect(evaluateAction(request(), context({ consecutiveCriticalFailures: 3 })).outcome).toBe("block");
    expect(evaluateAction(request(), context({ consecutiveCriticalFailures: 2 })).outcome).toBe("allow");
  });
});

describe("dry run", () => {
  it("reports the decision without executing", () => {
    expect(evaluateAction(request({ dryRun: true }), context())).toMatchObject({ outcome: "allow", execute: false });
  });
});

describe("catalog", () => {
  it("treats every spending action that is not an adjustment inside a budget as approval-required", () => {
    const autonomousSpenders = Object.entries(ACTION_CATALOG).filter(([, d]) => d.spends && d.tier !== "approval_required").map(([k]) => k);
    expect(autonomousSpenders).toEqual(["ads.adjust_existing_campaign_budget"]);
  });
  it("has no automatic action that changes an external system", () => {
    expect(Object.values(ACTION_CATALOG).filter((d) => d.tier === "automatic" && d.mutatesExternal)).toEqual([]);
  });
});
