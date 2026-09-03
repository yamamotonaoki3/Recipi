/** QueryProvider が子要素をそのまま描画することの確認。 */
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { QueryProvider } from "./QueryProvider";

it("子要素を描画する", async () => {
  await render(
    <QueryProvider>
      <Text>こんにちは</Text>
    </QueryProvider>,
  );
  expect(screen.getByText("こんにちは")).toBeOnTheScreen();
});
