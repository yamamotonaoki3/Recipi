import { useUpdateDismissal } from "../updateDismissal";

beforeEach(() => {
  useUpdateDismissal.setState({ dismissedVersion: null });
});

describe("useUpdateDismissal", () => {
  it("既定はnull（未確認）", () => {
    expect(useUpdateDismissal.getState().dismissedVersion).toBeNull();
  });

  it("dismiss(version)でそのバージョンを覚える", () => {
    useUpdateDismissal.getState().dismiss("1.2.3");
    expect(useUpdateDismissal.getState().dismissedVersion).toBe("1.2.3");
  });

  it("reset()でnullに戻す", () => {
    useUpdateDismissal.getState().dismiss("1.2.3");
    useUpdateDismissal.getState().reset();
    expect(useUpdateDismissal.getState().dismissedVersion).toBeNull();
  });
});
