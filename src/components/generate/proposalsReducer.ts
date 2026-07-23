export type StreamState = "idle" | "streaming" | "done" | "aborted";

export type ProposalStatus = "pending" | "editing" | "rejected" | "saving" | "saved" | "error";

export interface ProposalDraft {
  question: string;
  answer: string;
}

export interface Proposal {
  id: string;
  question: string;
  answer: string;
  status: ProposalStatus;
  draft: ProposalDraft | null;
  savedCardId: string | null;
  errorMessage: string | null;
}

export interface ProposalsState {
  streamState: StreamState;
  lastSubmittedText: string | null;
  errorMessage: string | null;
  proposals: Proposal[];
}

export const initialState: ProposalsState = {
  streamState: "idle",
  lastSubmittedText: null,
  errorMessage: null,
  proposals: [],
};

export type ProposalsAction =
  | { type: "stream/start"; text: string }
  | { type: "stream/chunk"; proposals: ProposalDraft[] }
  | { type: "stream/done" }
  | { type: "stream/abort"; reason: string }
  | { type: "reject"; id: string }
  | { type: "editStart"; id: string }
  | { type: "editChange"; id: string; patch: Partial<ProposalDraft> }
  | { type: "editSave"; id: string }
  | { type: "editCancel"; id: string }
  | { type: "saveStart"; id: string }
  | { type: "saveSuccess"; id: string; savedCardId: string }
  | { type: "saveError"; id: string; message: string }
  | { type: "reset" }
  | { type: "bulkRejectPending" };

function assignIds(existing: Proposal[], chunks: ProposalDraft[], makeId: () => string): Proposal[] {
  const visible = existing.filter((p) => p.status !== "rejected");
  const rejected = existing.filter((p) => p.status === "rejected");

  const next: Proposal[] = chunks.map((chunk, index) => {
    if (index < visible.length) {
      const prior = visible[index];
      return {
        ...prior,
        question: prior.status === "editing" ? prior.question : chunk.question,
        answer: prior.status === "editing" ? prior.answer : chunk.answer,
      };
    }
    return {
      id: makeId(),
      question: chunk.question,
      answer: chunk.answer,
      status: "pending",
      draft: null,
      savedCardId: null,
      errorMessage: null,
    };
  });

  return [...next, ...rejected];
}

export function makeReducer(makeId: () => string) {
  return function proposalsReducer(state: ProposalsState, action: ProposalsAction): ProposalsState {
    switch (action.type) {
      case "stream/start":
        return {
          streamState: "streaming",
          lastSubmittedText: action.text,
          errorMessage: null,
          proposals: [],
        };
      case "stream/chunk":
        return {
          ...state,
          proposals: assignIds(state.proposals, action.proposals, makeId),
        };
      case "stream/done":
        return { ...state, streamState: "done" };
      case "stream/abort":
        return { ...state, streamState: "aborted", errorMessage: action.reason };
      case "reject":
        return {
          ...state,
          proposals: state.proposals.map((p) => (p.id === action.id ? { ...p, status: "rejected" } : p)),
        };
      case "editStart":
        return {
          ...state,
          proposals: state.proposals.map((p) =>
            p.id === action.id ? { ...p, status: "editing", draft: { question: p.question, answer: p.answer } } : p,
          ),
        };
      case "editChange":
        return {
          ...state,
          proposals: state.proposals.map((p) =>
            p.id === action.id && p.draft ? { ...p, draft: { ...p.draft, ...action.patch } } : p,
          ),
        };
      case "editSave":
        return {
          ...state,
          proposals: state.proposals.map((p) =>
            p.id === action.id && p.draft
              ? { ...p, status: "pending", question: p.draft.question, answer: p.draft.answer, draft: null }
              : p,
          ),
        };
      case "editCancel":
        return {
          ...state,
          proposals: state.proposals.map((p) => (p.id === action.id ? { ...p, status: "pending", draft: null } : p)),
        };
      case "saveStart":
        return {
          ...state,
          proposals: state.proposals.map((p) =>
            p.id === action.id ? { ...p, status: "saving", errorMessage: null } : p,
          ),
        };
      case "saveSuccess":
        return {
          ...state,
          proposals: state.proposals.map((p) =>
            p.id === action.id ? { ...p, status: "saved", savedCardId: action.savedCardId, errorMessage: null } : p,
          ),
        };
      case "saveError":
        return {
          ...state,
          proposals: state.proposals.map((p) =>
            p.id === action.id ? { ...p, status: "error", errorMessage: action.message } : p,
          ),
        };
      case "reset":
        return initialState;
      case "bulkRejectPending":
        return {
          ...state,
          proposals: state.proposals.map((p) => (p.status === "pending" ? { ...p, status: "rejected" } : p)),
        };
      default:
        return state;
    }
  };
}

export const proposalsReducer = makeReducer(() => crypto.randomUUID());
