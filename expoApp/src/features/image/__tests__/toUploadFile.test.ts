/**
 * `pickImage` がネイティブで実際に選んだ画像を送信可能な形にする経路（Issue #285）。
 *
 * Expo SDK 57 のグローバル fetch は React Native 独自の `{ uri, name, type }` を
 * 受け付けず（`Unsupported FormDataPart implementation`）、実体の Blob が必要になった。
 * `toUploadFile` は非公開なので、`pickImage` 経由で確認する。
 */
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

import { pickImage } from "../pickImage";

jest.mock("expo-image-picker");
jest.mock("expo-image-manipulator");

const mockPicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
const mockManipulator = ImageManipulator as jest.Mocked<typeof ImageManipulator>;

beforeEach(() => {
  jest.clearAllMocks();
  mockPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
  mockPicker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///picked.jpg", width: 100, height: 100 } as never],
  });
  // 上限以下なので shrink() は resize せずそのまま返す。
  const context = { renderAsync: jest.fn(), release: jest.fn() };
  mockManipulator.ImageManipulator.manipulate = jest.fn().mockReturnValue(context);
});

it("ネイティブでは選んだ画像の URI を実体の Blob として読み込む（uri 形式のまま送らない）", async () => {
  Object.defineProperty(Platform, "OS", { get: () => "android" });
  const blob = new Blob(["image-bytes"], { type: "image/jpeg" });
  class FakeXHR {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    response: unknown = blob;
    responseType = "";
    open = jest.fn();
    send = jest.fn(() => this.onload?.());
  }
  const fakeXHR = new FakeXHR();
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = jest
    .fn()
    .mockImplementation(() => fakeXHR);

  const result = await pickImage("library", 2048);

  expect(fakeXHR.open).toHaveBeenCalledWith("GET", "file:///picked.jpg");
  expect(result?.file).toBe(blob);
  // `{ uri, name, type }` 形式（Expo の fetch が拒否する形）ではない。
  expect(result?.file).not.toHaveProperty("uri");
});

it("読み込みに失敗したら分かるメッセージで例外にする", async () => {
  Object.defineProperty(Platform, "OS", { get: () => "android" });
  class FakeXHR {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    responseType = "";
    open = jest.fn();
    send = jest.fn(() => this.onerror?.());
  }
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = jest
    .fn()
    .mockImplementation(() => new FakeXHR());

  await expect(pickImage("library", 2048)).rejects.toThrow("選んだ画像を読み込めませんでした");
});
