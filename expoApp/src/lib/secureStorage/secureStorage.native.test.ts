import * as SecureStore from "expo-secure-store";

import { nativeSecureStorage } from "./secureStorage.native";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe("nativeSecureStorage", () => {
  it("getRefreshToken は expo-secure-store から読む", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("stored-token");
    await expect(nativeSecureStorage.getRefreshToken()).resolves.toBe("stored-token");
  });

  it("setRefreshToken は expo-secure-store に保存する", async () => {
    await nativeSecureStorage.setRefreshToken("new-token");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("recipi.refreshToken", "new-token");
  });

  it("deleteRefreshToken は expo-secure-store から削除する", async () => {
    await nativeSecureStorage.deleteRefreshToken();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("recipi.refreshToken");
  });

  it("getUser は expo-secure-store から読む", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('{"id":"u1"}');
    await expect(nativeSecureStorage.getUser()).resolves.toBe('{"id":"u1"}');
  });

  it("setUser は expo-secure-store に保存する", async () => {
    await nativeSecureStorage.setUser('{"id":"u1"}');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("recipi.user", '{"id":"u1"}');
  });

  it("deleteUser は expo-secure-store から削除する", async () => {
    await nativeSecureStorage.deleteUser();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("recipi.user");
  });
});
