import { describe, expect, it } from "vitest";
import { initialState, makeReducer } from "./proposalsReducer";

function newReducer() {
  let counter = 0;
  return makeReducer(() => `id-${++counter}`);
}

describe("proposalsReducer", () => {
  it("has initial state idle with empty proposals", () => {
    expect(initialState.streamState).toBe("idle");
    expect(initialState.proposals).toEqual([]);
  });

  it("stream/start clears proposals and sets streaming", () => {
    const reducer = newReducer();
    const state = reducer(
      {
        ...initialState,
        proposals: [
          {
            id: "old",
            question: "q",
            answer: "a",
            status: "pending",
            draft: null,
            savedCardId: null,
            errorMessage: null,
          },
        ],
      },
      { type: "stream/start", text: "hello" },
    );
    expect(state.streamState).toBe("streaming");
    expect(state.lastSubmittedText).toBe("hello");
    expect(state.proposals).toEqual([]);
    expect(state.errorMessage).toBeNull();
  });

  it("stream/chunk inserts new proposals and stabilizes IDs on subsequent chunks", () => {
    const reducer = newReducer();
    let state = reducer(initialState, { type: "stream/start", text: "t" });
    state = reducer(state, {
      type: "stream/chunk",
      proposals: [{ question: "Q1", answer: "A1" }],
    });
    expect(state.proposals).toHaveLength(1);
    expect(state.proposals[0].id).toBe("id-1");
    state = reducer(state, {
      type: "stream/chunk",
      proposals: [
        { question: "Q1", answer: "A1" },
        { question: "Q2", answer: "A2" },
      ],
    });
    expect(state.proposals[0].id).toBe("id-1");
    expect(state.proposals[1].id).toBe("id-2");
  });

  it("stream/done preserves proposals and sets streamState=done", () => {
    const reducer = newReducer();
    let state = reducer(initialState, { type: "stream/start", text: "t" });
    state = reducer(state, {
      type: "stream/chunk",
      proposals: [{ question: "Q", answer: "A" }],
    });
    state = reducer(state, { type: "stream/done" });
    expect(state.streamState).toBe("done");
    expect(state.proposals).toHaveLength(1);
  });

  it("stream/abort keeps proposals and records the reason", () => {
    const reducer = newReducer();
    let state = reducer(initialState, { type: "stream/start", text: "t" });
    state = reducer(state, {
      type: "stream/chunk",
      proposals: [{ question: "Q", answer: "A" }],
    });
    state = reducer(state, { type: "stream/abort", reason: "network" });
    expect(state.streamState).toBe("aborted");
    expect(state.errorMessage).toBe("network");
    expect(state.proposals).toHaveLength(1);
  });

  it("reject marks a proposal rejected (filtered from visible)", () => {
    const reducer = newReducer();
    let state = reducer(initialState, { type: "stream/start", text: "t" });
    state = reducer(state, {
      type: "stream/chunk",
      proposals: [
        { question: "Q1", answer: "A1" },
        { question: "Q2", answer: "A2" },
      ],
    });
    state = reducer(state, { type: "reject", id: "id-1" });
    const target = state.proposals.find((p) => p.id === "id-1");
    expect(target?.status).toBe("rejected");
  });

  it("editStart puts a proposal into editing with a draft mirror", () => {
    const reducer = newReducer();
    let state = reducer(initialState, { type: "stream/start", text: "t" });
    state = reducer(state, {
      type: "stream/chunk",
      proposals: [{ question: "Q", answer: "A" }],
    });
    state = reducer(state, { type: "editStart", id: "id-1" });
    expect(state.proposals[0].status).toBe("editing");
    expect(state.proposals[0].draft).toEqual({ question: "Q", answer: "A" });
  });

  it("editChange mutates only the target proposal's draft", () => {
    const reducer = newReducer();
    let state = reducer(initialState, { type: "stream/start", text: "t" });
    state = reducer(state, {
      type: "stream/chunk",
      proposals: [
        { question: "Q1", answer: "A1" },
        { question: "Q2", answer: "A2" },
      ],
    });
    state = reducer(state, { type: "editStart", id: "id-1" });
    state = reducer(state, { type: "editChange", id: "id-1", patch: { question: "Q1x" } });
    expect(state.proposals[0].draft).toEqual({ question: "Q1x", answer: "A1" });
    expect(state.proposals[1].draft).toBeNull();
  });

  it("editSave returns proposal to pending with new question/answer", () => {
    const reducer = newReducer();
    let state = reducer(initialState, { type: "stream/start", text: "t" });
    state = reducer(state, {
      type: "stream/chunk",
      proposals: [{ question: "Q", answer: "A" }],
    });
    state = reducer(state, { type: "editStart", id: "id-1" });
    state = reducer(state, { type: "editChange", id: "id-1", patch: { question: "Qx", answer: "Ax" } });
    state = reducer(state, { type: "editSave", id: "id-1" });
    expect(state.proposals[0].status).toBe("pending");
    expect(state.proposals[0].question).toBe("Qx");
    expect(state.proposals[0].answer).toBe("Ax");
    expect(state.proposals[0].draft).toBeNull();
  });

  it("editCancel returns proposal to pending with original text", () => {
    const reducer = newReducer();
    let state = reducer(initialState, { type: "stream/start", text: "t" });
    state = reducer(state, {
      type: "stream/chunk",
      proposals: [{ question: "Q", answer: "A" }],
    });
    state = reducer(state, { type: "editStart", id: "id-1" });
    state = reducer(state, { type: "editChange", id: "id-1", patch: { question: "Qx" } });
    state = reducer(state, { type: "editCancel", id: "id-1" });
    expect(state.proposals[0].status).toBe("pending");
    expect(state.proposals[0].question).toBe("Q");
    expect(state.proposals[0].draft).toBeNull();
  });

  it("reset returns to idle with empty proposals", () => {
    const reducer = newReducer();
    let state = reducer(initialState, { type: "stream/start", text: "t" });
    state = reducer(state, {
      type: "stream/chunk",
      proposals: [{ question: "Q", answer: "A" }],
    });
    state = reducer(state, { type: "reset" });
    expect(state).toEqual(initialState);
  });

  it("saveStart transitions proposal to saving and clears prior error", () => {
    const reducer = newReducer();
    let state = reducer(initialState, { type: "stream/start", text: "t" });
    state = reducer(state, {
      type: "stream/chunk",
      proposals: [{ question: "Q", answer: "A" }],
    });
    state = reducer(state, { type: "saveError", id: "id-1", message: "old" });
    state = reducer(state, { type: "saveStart", id: "id-1" });
    expect(state.proposals[0].status).toBe("saving");
    expect(state.proposals[0].errorMessage).toBeNull();
  });

  it("saveSuccess transitions to saved and captures the DB card id", () => {
    const reducer = newReducer();
    let state = reducer(initialState, { type: "stream/start", text: "t" });
    state = reducer(state, {
      type: "stream/chunk",
      proposals: [{ question: "Q", answer: "A" }],
    });
    state = reducer(state, { type: "saveStart", id: "id-1" });
    state = reducer(state, { type: "saveSuccess", id: "id-1", savedCardId: "card-42" });
    expect(state.proposals[0].status).toBe("saved");
    expect(state.proposals[0].savedCardId).toBe("card-42");
    expect(state.proposals[0].errorMessage).toBeNull();
  });

  it("saveError transitions to error and records the message", () => {
    const reducer = newReducer();
    let state = reducer(initialState, { type: "stream/start", text: "t" });
    state = reducer(state, {
      type: "stream/chunk",
      proposals: [{ question: "Q", answer: "A" }],
    });
    state = reducer(state, { type: "saveStart", id: "id-1" });
    state = reducer(state, { type: "saveError", id: "id-1", message: "network fail" });
    expect(state.proposals[0].status).toBe("error");
    expect(state.proposals[0].errorMessage).toBe("network fail");
  });

  it("saveStart after saveError clears the message and re-enters saving (retry path)", () => {
    const reducer = newReducer();
    let state = reducer(initialState, { type: "stream/start", text: "t" });
    state = reducer(state, {
      type: "stream/chunk",
      proposals: [{ question: "Q", answer: "A" }],
    });
    state = reducer(state, { type: "saveStart", id: "id-1" });
    state = reducer(state, { type: "saveError", id: "id-1", message: "fail" });
    state = reducer(state, { type: "saveStart", id: "id-1" });
    expect(state.proposals[0].status).toBe("saving");
    expect(state.proposals[0].errorMessage).toBeNull();
  });
});
