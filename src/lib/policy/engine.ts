/**
 * The action policy engine. A pure function: given a requested action and the current
 * state of limits, switches and approvals, it returns whether the action may execute now.
 *
 * It is called twice for every action: when the action is queued, and again immediately
 * before execution with freshly loaded context, so stale approvals, spent budgets and a
 * newly engaged kill switch are all caught.
 *
 * Nothing in this module can be influenced by model output except `request`, and no
 * request can change the context it is judged against.
 */
export type RiskTier = "automatic" | "conditional" | "approval_required";

export type ActionDefinition = {
  tier: RiskTier;
  /** True when the action changes something outside JARVIS's own records. */
  mutatesExternal: boolean;
  /** True when `valueMinor` is money leaving the business or committed to spend. */
  spends: boolean;
};

/** The allowlist. An action type that is not listed here cannot run at all. */
export const ACTION_CATALOG: Readonly<Record<string, ActionDefinition>> = {
  "report.generate": { tier: "automatic", mutatesExternal: false, spends: false },
  "research.analyze": { tier: "automatic", mutatesExternal: false, spends: false },
  "content.draft": { tier: "automatic", mutatesExternal: false, spends: false },
  "task.create": { tier: "automatic", mutatesExternal: false, spends: false },
  "inventory.monitor": { tier: "automatic", mutatesExternal: false, spends: false },
  "content.publish_approved_template": { tier: "conditional", mutatesExternal: true, spends: false },
  "catalog.update_permitted_fields": { tier: "conditional", mutatesExternal: true, spends: false },
  "catalog.update_price": { tier: "conditional", mutatesExternal: true, spends: false },
  "support.send_approved_response": { tier: "conditional", mutatesExternal: true, spends: false },
  "retention.run_configured_workflow": { tier: "conditional", mutatesExternal: true, spends: false },
  "ads.adjust_existing_campaign_budget": { tier: "conditional", mutatesExternal: true, spends: true },
  "ads.launch_campaign": { tier: "approval_required", mutatesExternal: true, spends: true },
  "supplier.place_purchase_order": { tier: "approval_required", mutatesExternal: true, spends: true },
  "payment.initiate_transfer": { tier: "approval_required", mutatesExternal: true, spends: true },
  "refund.issue_exceptional": { tier: "approval_required", mutatesExternal: true, spends: true },
  "legal.accept_commitment": { tier: "approval_required", mutatesExternal: true, spends: false },
  "catalog.delete_product": { tier: "approval_required", mutatesExternal: true, spends: false },
};

/**
 * Actions on the policy system itself. People do these through the settings screens;
 * an agent may never request them, with or without an approval.
 */
export const AGENT_FORBIDDEN_PREFIXES = ["permission.", "budget.", "policy.", "approval.", "credential.", "security.", "killswitch."] as const;

export type ActionRequest = {
  actionId: string;
  actionType: string;
  actor: { kind: "agent"; agentRunId: string } | { kind: "user"; userId: string };
  /** Spend, or the monetary value at stake. null when unknown. */
  valueMinor: number | null;
  /** For price changes: contribution margin after the change, in basis points. null when unknown. */
  resultingMarginBps?: number | null;
  /** Hash of the exact payload that will be executed. */
  payloadHash: string;
  expiresAt: Date;
  dryRun: boolean;
};

export type Approval = {
  actionId: string;
  decision: "approved" | "rejected";
  decidedByUserId: string;
  /** Hash of the payload the approver saw. */
  payloadHash: string;
  expiresAt: Date;
};

export type PolicyContext = {
  now: Date;
  /** Kill switches, most specific scope included. Any one engaged stops autonomous mutations. */
  autonomyPaused: { organization: boolean; brand: boolean; store: boolean };
  /** Action types enabled for this brand/store. An action must be in the catalog AND here. */
  enabledActionTypes: ReadonlySet<string>;
  limits: {
    maxActionValueMinor: number | null;
    dailyLimitMinor: number | null;
    monthlyLimitMinor: number | null;
    maxActionsPerDay: number | null;
  } | null;
  usage: { spentTodayMinor: number; spentThisMonthMinor: number; actionsToday: number };
  marginFloorBps: number | null;
  approval: Approval | null;
  /** Consecutive critical failures recorded for this scope, and the shutdown threshold. */
  consecutiveCriticalFailures: number;
  criticalFailureThreshold: number;
};

export type Decision =
  | { outcome: "allow"; execute: boolean; reasons: string[] }
  | { outcome: "require_approval"; execute: false; reasons: string[] }
  | { outcome: "block"; execute: false; reasons: string[] };

const block = (...reasons: string[]): Decision => ({ outcome: "block", execute: false, reasons });
const needApproval = (...reasons: string[]): Decision => ({ outcome: "require_approval", execute: false, reasons });

export function evaluateAction(request: ActionRequest, context: PolicyContext): Decision {
  const { now } = context;

  if (request.actor.kind === "agent" && AGENT_FORBIDDEN_PREFIXES.some((prefix) => request.actionType.startsWith(prefix))) {
    return block("Agents cannot change permissions, budgets, policies, approvals, credentials or security settings");
  }

  const definition = Object.hasOwn(ACTION_CATALOG, request.actionType) ? ACTION_CATALOG[request.actionType] : undefined;
  if (!definition) return block(`Action type "${request.actionType}" is not on the allowlist`);
  if (!context.enabledActionTypes.has(request.actionType)) {
    return block(`Action type "${request.actionType}" is not enabled for this brand or store`);
  }
  if (request.expiresAt.getTime() <= now.getTime()) return block("The action has expired");
  if (request.valueMinor !== null && (!Number.isSafeInteger(request.valueMinor) || request.valueMinor < 0)) {
    return block("The action value is not a valid amount");
  }

  const isMutation = definition.mutatesExternal;
  if (isMutation && request.actor.kind === "agent") {
    const paused = context.autonomyPaused;
    if (paused.organization || paused.brand || paused.store) {
      return block("Autonomous actions are switched off");
    }
    if (context.consecutiveCriticalFailures >= context.criticalFailureThreshold) {
      return block("Autonomous actions are suspended after repeated critical failures");
    }
  }

  // Read-only and internal work.
  if (definition.tier === "automatic") {
    return { outcome: "allow", execute: !request.dryRun, reasons: ["Automatic tier"] };
  }

  const approval = validApproval(request, context);
  if (approval.rejected) return block("The action was rejected by an approver");

  if (definition.tier === "approval_required") {
    return approval.valid
      ? { outcome: "allow", execute: !request.dryRun, reasons: ["Approved by an authorized person"] }
      : needApproval("This action type always requires approval", ...approval.problems);
  }

  // Conditional tier: runs on its own only inside explicit, known limits.
  const escalations: string[] = [];
  const limits = context.limits;
  if (!limits) escalations.push("No limits are configured for this scope");

  if (definition.spends) {
    if (request.valueMinor === null) {
      escalations.push("The spend amount is unknown");
    } else if (limits) {
      if (limits.maxActionValueMinor === null && limits.dailyLimitMinor === null && limits.monthlyLimitMinor === null) {
        escalations.push("No spending limit is configured");
      }
      if (limits.maxActionValueMinor !== null && request.valueMinor > limits.maxActionValueMinor) {
        escalations.push("Above the maximum value for a single action");
      }
      if (limits.dailyLimitMinor !== null && context.usage.spentTodayMinor + request.valueMinor > limits.dailyLimitMinor) {
        escalations.push("Would exceed the daily spending limit");
      }
      if (limits.monthlyLimitMinor !== null && context.usage.spentThisMonthMinor + request.valueMinor > limits.monthlyLimitMinor) {
        escalations.push("Would exceed the monthly spending limit");
      }
    }
  }
  if (limits && limits.maxActionsPerDay !== null && context.usage.actionsToday + 1 > limits.maxActionsPerDay) {
    escalations.push("Would exceed the daily action count");
  }

  if (request.actionType === "catalog.update_price") {
    if (context.marginFloorBps === null) escalations.push("No margin floor is configured");
    else if (request.resultingMarginBps === null || request.resultingMarginBps === undefined) {
      escalations.push("The resulting margin is unknown");
    } else if (request.resultingMarginBps < context.marginFloorBps) {
      escalations.push("Price would fall below the minimum margin floor");
    }
  }

  if (escalations.length === 0) {
    return { outcome: "allow", execute: !request.dryRun, reasons: ["Within configured limits"] };
  }
  if (approval.valid) {
    return { outcome: "allow", execute: !request.dryRun, reasons: ["Outside automatic limits; approved by an authorized person", ...escalations] };
  }
  return needApproval(...escalations, ...approval.problems);
}

function validApproval(request: ActionRequest, context: PolicyContext): { valid: boolean; rejected: boolean; problems: string[] } {
  const approval = context.approval;
  if (!approval) return { valid: false, rejected: false, problems: [] };
  if (approval.actionId !== request.actionId) return { valid: false, rejected: false, problems: ["The approval belongs to a different action"] };
  if (approval.decision === "rejected") return { valid: false, rejected: true, problems: [] };
  const problems: string[] = [];
  if (approval.expiresAt.getTime() <= context.now.getTime()) problems.push("The approval has expired");
  if (approval.payloadHash !== request.payloadHash) problems.push("The action changed after it was approved");
  // Who may approve (owner/admin, not the requester) is enforced in the database by
  // validate_approval(); an approval row that exists has already passed that check.
  return { valid: problems.length === 0, rejected: false, problems };
}
