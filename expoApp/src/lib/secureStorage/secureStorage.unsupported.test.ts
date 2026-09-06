import { unsupportedSecureStorage } from "./secureStorage.unsupported";

describe("unsupportedSecureStorage", () => {
  it("getRefreshToken は常に null", async () => {
    await expect(unsupportedSecureStorage.getRefreshToken()).resolves.toBeNull();
  });

  it("setRefreshToken / deleteRefreshToken は例外を投げない", async () => {
    await expect(unsupportedSecureStorage.setRefreshToken("x")).resolves.toBeUndefined();
    await expect(unsupportedSecureStorage.deleteRefreshToken()).resolves.toBeUndefined();
  });

  it("getUser は常に null", async () => {
    await expect(unsupportedSecureStorage.getUser()).resolves.toBeNull();
  });

  it("setUser / deleteUser は例外を投げない", async () => {
    await expect(unsupportedSecureStorage.setUser('{"id":"u1"}')).resolves.toBeUndefined();
    await expect(unsupportedSecureStorage.deleteUser()).resolves.toBeUndefined();
  });
});
