import { render } from "@testing-library/react-native";

import RootLayout from "../_layout";

jest.mock("expo-router", () => ({ Stack: () => null }));

describe("RootLayout", () => {
  it("正常にレンダリングされる", async () => {
    await expect(render(<RootLayout />)).resolves.toBeDefined();
  });
});
