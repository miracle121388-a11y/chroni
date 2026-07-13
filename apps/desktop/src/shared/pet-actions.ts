import type { CompanionState, IntakePayload, PetAction, PetActionCommand } from "./types.js";

export type PetMotionState = {
  active?: PetAction;
  queue: PetAction[];
};

export type PetMotionEvent =
  | { type: "command"; command: PetActionCommand }
  | { type: "finished"; action: PetAction };

export function basePetAction(state: CompanionState): PetAction {
  if (state === "processing") return "study";
  if (state === "sleeping") return "sleep";
  return "idle";
}

export function inputPetAction(payload: IntakePayload): PetAction {
  return payload.kind === "text" ? "eat" : "study";
}

export function attentionPetAction(previous: CompanionState, next: CompanionState): PetAction | undefined {
  if (previous === next) return undefined;
  if (next === "needs_clarification" || next === "deadline_near" || next === "overdue") return "wake";
  return undefined;
}

export function resolvedPetAction(input: {
  moving: boolean;
  base: PetAction;
  active?: PetAction;
}): PetAction {
  if (input.moving) return "drag";
  if (input.base === "sleep" && input.active !== "wake") return "sleep";
  return input.active ?? input.base;
}

export function isOneShotPetAction(action: PetAction): boolean {
  return action === "cling" || action === "walk" || action === "wake" || action === "eat" || action === "pet" || action === "play" || action === "cat";
}

export function petMotionReducer(state: PetMotionState, event: PetMotionEvent): PetMotionState {
  if (event.type === "finished") {
    if (state.active !== event.action || event.action === "sleep") return state;
    const [next, ...queue] = state.queue;
    return { active: next, queue };
  }

  const { action, mode } = event.command;
  if (mode === "replace") {
    return { active: action === "idle" ? undefined : action, queue: [] };
  }
  if (action === "idle" || state.active === action || state.queue.includes(action)) return state;
  if (!state.active) return { active: action, queue: [] };
  return { active: state.active, queue: [...state.queue, action] };
}
