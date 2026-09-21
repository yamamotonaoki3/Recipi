import { renderHook } from "@testing-library/react-native";

import { notifyRetap, useRetap } from "./retap";

describe("useRetap", () => {
  it("同じ destination の再タップだけを通知し、購読を外すと止まる", async () => {
    const onHome = jest.fn();
    const onHistory = jest.fn();
    const home = await renderHook(() => useRetap("/home", onHome));
    await renderHook(() => useRetap("/history", onHistory));

    notifyRetap("/home");
    notifyRetap("/home");
    expect(onHome).toHaveBeenCalledTimes(2);
    expect(onHistory).not.toHaveBeenCalled();

    await home.unmount();
    notifyRetap("/home");
    expect(onHome).toHaveBeenCalledTimes(2);
  });
});
