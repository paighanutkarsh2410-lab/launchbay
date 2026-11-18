import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer } from "react";
import { API_BASE, type Launch, type Step, type StepStatus } from "./api";

export interface LaunchState {
  launch: Launch | null;
  url: string | null;
  repoUrl: string | null;
  connected: boolean;
}

type Action =
  | { type: "snapshot"; launch: Launch }
  | { type: "step"; key: string; status: StepStatus; detail: string | null; started_at: string | null; finished_at: string | null }
  | { type: "log"; key: string; line: string }
  | { type: "launch"; status: StepStatus; error: string | null; url: string | null; repo_url: string | null }
  | { type: "connected"; value: boolean }
  | { type: "reset" };

const initial: LaunchState = { launch: null, url: null, repoUrl: null, connected: false };

function updateStep(launch: Launch, key: string, change: (step: Step) => Step): Launch {
  return { ...launch, steps: launch.steps.map((s) => (s.key === key ? change(s) : s)) };
}

function reducer(state: LaunchState, action: Action): LaunchState {
  switch (action.type) {
    case "reset":
      return initial;
    case "connected":
      return { ...state, connected: action.value };
    case "snapshot":
      return { ...state, launch: action.launch };
    case "step": {
      if (!state.launch) return state;
      const { key, status, detail, started_at, finished_at } = action;
      return {
        ...state,
        launch: updateStep(state.launch, key, (s) => ({ ...s, status, detail, started_at, finished_at })),
      };
    }
    case "log":
      if (!state.launch) return state;
      return {
        ...state,
        launch: updateStep(state.launch, action.key, (s) => ({ ...s, logs: [...s.logs, action.line] })),
      };
    case "launch":
      if (!state.launch) return state;
      return {
        ...state,
        url: action.url,
        repoUrl: action.repo_url,
        launch: {
          ...state.launch,
          status: action.status,
          error: action.error,
          finished_at: new Date().toISOString(),
        },
      };
  }
}

/** Follows a launch live over Server-Sent Events: a snapshot, then every change. */
/** `launchId` re-subscribes when a retry starts a new launch for the same service. */
export function useLaunchStream(name: string | undefined, launchId?: string): LaunchState {
  const [state, dispatch] = useReducer(reducer, initial);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!name) return;
    dispatch({ type: "reset" });
    const source = new EventSource(`${API_BASE}/api/services/${name}/events`);
    const on = <T,>(type: string, handler: (data: T) => void) =>
      source.addEventListener(type, (event) => handler(JSON.parse((event as MessageEvent).data) as T));

    source.onopen = () => dispatch({ type: "connected", value: true });
    on("snapshot", (launch: Launch) => dispatch({ type: "snapshot", launch }));
    on("step", (data: Omit<Extract<Action, { type: "step" }>, "type">) => dispatch({ type: "step", ...data }));
    on("log", (data: { key: string; line: string }) => dispatch({ type: "log", ...data }));
    on("launch", (data: Omit<Extract<Action, { type: "launch" }>, "type">) => {
      dispatch({ type: "launch", ...data });
      source.close();
      dispatch({ type: "connected", value: false });
      void queryClient.invalidateQueries();
    });
    // The server ends the stream once a finished launch has been replayed.
    source.onerror = () => {
      source.close();
      dispatch({ type: "connected", value: false });
    };
    return () => source.close();
  }, [name, launchId, queryClient]);

  return state;
}
