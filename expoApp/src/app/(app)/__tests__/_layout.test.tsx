import { render } from "@testing-library/react-native";

import AppLayout from "../_layout";
import { useProtectedRoute } from "@/features/auth/useProtectedRoute";

jest.mock("expo-router", () => {
  function Stack() {
    return null;
  }
  Stack.Screen = function Screen() {
    return null;
  };
  return { Stack };
});
jest.mock("@/features/auth/useProtectedRoute", () => ({ useProtectedRoute: jest.fn() }));

describe("AppLayout", () => {
  it("useProtectedRoute を呼ぶ", async () => {
    await render(<AppLayout />);
    expect(useProtectedRoute).toHaveBeenCalled();
  });
});
