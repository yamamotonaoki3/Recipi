import { act, fireEvent, render } from "@testing-library/react-native";
import { Text } from "react-native";

import { AvatarCropDialog, useAvatarCropper } from "../AvatarCropDialog";

// 縦長 400x800 の写真。最初は中央（y 200〜600）を正方形に切り抜く。
const asset = { uri: "file:///photo.jpg", width: 400, height: 800 };

describe("AvatarCropDialog", () => {
  it("そのまま確定すると中央の正方形が返る", async () => {
    const onConfirm = jest.fn();
    const { getByTestId } = await render(
      <AvatarCropDialog asset={asset} onConfirm={onConfirm} onCancel={jest.fn()} />,
    );
    await fireEvent.press(getByTestId("avatar-crop-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({ originX: 0, originY: 200, width: 400, height: 400 });
  });

  it("拡大すると切り抜く範囲が狭くなり、縮小で戻る（等倍より小さくはならない）", async () => {
    const onConfirm = jest.fn();
    const { getByTestId } = await render(
      <AvatarCropDialog asset={asset} onConfirm={onConfirm} onCancel={jest.fn()} />,
    );
    expect(getByTestId("avatar-crop-zoom-out").props.accessibilityState?.disabled).toBe(true);

    await fireEvent.press(getByTestId("avatar-crop-zoom-in"));
    await fireEvent.press(getByTestId("avatar-crop-zoom-in"));
    await fireEvent.press(getByTestId("avatar-crop-confirm"));
    // 拡大率 1.5 → 400 / 1.5 ≒ 267 の正方形。
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ width: 267, height: 267 }));
  });

  it("キャンセルは確定を呼ばない", async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const { getByTestId } = await render(
      <AvatarCropDialog asset={asset} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    await fireEvent.press(getByTestId("avatar-crop-cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("asset が無ければ何も出さない", async () => {
    const { queryByTestId } = await render(
      <AvatarCropDialog asset={null} onConfirm={jest.fn()} onCancel={jest.fn()} />,
    );
    expect(queryByTestId("avatar-crop-viewport")).toBeNull();
  });
});

describe("useAvatarCropper", () => {
  function Harness({ onResult }: { onResult: (r: unknown) => void }) {
    const { chooseCrop, dialog } = useAvatarCropper();
    return (
      <>
        <Text testID="start" onPress={() => void chooseCrop(asset).then(onResult)}>
          start
        </Text>
        {dialog}
      </>
    );
  }

  it("確定で範囲、キャンセルで null を返す", async () => {
    const results: unknown[] = [];
    const { getByTestId, queryByTestId } = await render(
      <Harness onResult={(r) => results.push(r)} />,
    );

    await fireEvent.press(getByTestId("start"));
    await fireEvent.press(getByTestId("avatar-crop-confirm"));
    await act(async () => {});
    expect(results[0]).toEqual({ originX: 0, originY: 200, width: 400, height: 400 });
    expect(queryByTestId("avatar-crop-viewport")).toBeNull();

    await fireEvent.press(getByTestId("start"));
    await fireEvent.press(getByTestId("avatar-crop-cancel"));
    await act(async () => {});
    expect(results[1]).toBeNull();
  });
});
