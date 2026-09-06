import { render } from "@testing-library/react-native";

import Index from "./index";

const mockRedirect = jest.fn((_props: { href: string }) => null);

jest.mock("expo-router", () => ({
  Redirect: (props: { href: string }) => mockRedirect(props),
}));

describe("Index", () => {
  it("常に /splash へリダイレクトする", async () => {
    await render(<Index />);
    expect(mockRedirect).toHaveBeenCalledWith({ href: "/splash" });
  });
});
