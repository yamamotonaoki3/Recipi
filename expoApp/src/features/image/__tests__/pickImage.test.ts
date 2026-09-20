import { imageResizeAction } from "../pickImage";

describe("imageResizeAction", () => {
  it("uses the configured maximum for a landscape image", () => {
    expect(imageResizeAction(4000, 3000, 1536)).toEqual({ width: 1536 });
  });

  it("uses the configured maximum for a portrait image", () => {
    expect(imageResizeAction(3000, 4000, 1536)).toEqual({ height: 1536 });
  });
});
