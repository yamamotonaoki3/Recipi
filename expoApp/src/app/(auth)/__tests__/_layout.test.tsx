import { render } from "@testing-library/react-native";

import AuthLayout from "../_layout";

jest.mock("expo-router", () => ({ Stack: () => null }));

describe("AuthLayout", () => {
  it("正常にレンダリングされる", async () => {
    await expect(render(<AuthLayout />)).resolves.toBeDefined();
  });
});
