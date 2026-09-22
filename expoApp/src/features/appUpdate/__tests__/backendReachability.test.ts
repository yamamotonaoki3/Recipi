import { useBackendReachability } from "../backendReachability";

beforeEach(() => {
  useBackendReachability.setState({ status: "ok" });
});

describe("useBackendReachability", () => {
  it("既定はok", () => {
    expect(useBackendReachability.getState().status).toBe("ok");
  });

  it("markUnreachable()でunreachableになる", () => {
    useBackendReachability.getState().markUnreachable();
    expect(useBackendReachability.getState().status).toBe("unreachable");
  });

  it("markReachable()でokに戻る", () => {
    useBackendReachability.getState().markUnreachable();
    useBackendReachability.getState().markReachable();
    expect(useBackendReachability.getState().status).toBe("ok");
  });
});
