/**
 * ImagePickerField の BB テスト（Issue #40 テスト要件の「アップロード状態の
 * 4 分岐 = 未 / 中 / 完 / 失敗」）。
 *
 * ピッカー（expo-image-picker）と画像加工（expo-image-manipulator）は
 * jest.setup.js で共通モック済み。ここではアップロード API だけを差し替える。
 *
 * RNTL v14 は `render` / `fireEvent` が非同期なので必ず `await` する
 * （既存の RecipeEditor.test.tsx と同じ書き方）。
 */
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { useState } from "react";
import * as ImagePicker from "expo-image-picker";

import { ImagePickerField } from "../ImagePickerField";
import * as imageApi from "@/features/image/api";
import { ApiError } from "@/features/auth/api";

jest.mock("@/features/image/api", () => ({ uploadImage: jest.fn() }));

const mockUpload = imageApi.uploadImage as jest.Mock;
const mockLaunchLibrary = ImagePicker.launchImageLibraryAsync as jest.Mock;
const mockLaunchCamera = ImagePicker.launchCameraAsync as jest.Mock;
const mockRequestPermission = ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock;
const mockRequestCameraPermission = ImagePicker.requestCameraPermissionsAsync as jest.Mock;

/** 「利用者が画像を 1 枚選んだ」状態にする。 */
function pickSucceeds() {
  mockLaunchLibrary.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///tmp/a.jpg", width: 800, height: 600 }],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequestPermission.mockResolvedValue({ granted: true, status: "granted" });
  mockRequestCameraPermission.mockResolvedValue({ granted: true, status: "granted" });
  // 既定は「キャンセルされた」。選択させたいテストだけ pickSucceeds() で上書きする。
  mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });
  mockLaunchCamera.mockResolvedValue({ canceled: true, assets: null });
});

describe("未選択の状態", () => {
  it("プレースホルダと「画像を追加」を出し、削除ボタンは出さない", async () => {
    const { getByTestId, getByText, queryByTestId } = await render(
      <ImagePickerField testID="f" imageKey={null} onChange={jest.fn()} />,
    );

    expect(getByTestId("f-placeholder")).toBeTruthy();
    expect(getByText("画像を追加")).toBeTruthy();
    expect(queryByTestId("f-remove")).toBeNull();
  });
});

describe("選択して成功したとき", () => {
  it("「写真を撮る」からカメラを起動する", async () => {
    mockLaunchCamera.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///tmp/camera.jpg", width: 800, height: 600 }],
    });
    mockUpload.mockResolvedValue({ key: "uploads/camera.jpg", url: "https://x/camera.jpg" });

    const { getByTestId } = await render(
      <ImagePickerField testID="f" imageKey={null} onChange={jest.fn()} />,
    );
    await fireEvent.press(getByTestId("f-camera"));

    await waitFor(() => expect(mockLaunchCamera).toHaveBeenCalled());
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it("アップロードしたキーを onChange で返す", async () => {
    pickSucceeds();
    mockUpload.mockResolvedValue({ key: "uploads/new.jpg", url: "https://x/new.jpg" });
    const onChange = jest.fn();

    const { getByTestId } = await render(
      <ImagePickerField testID="f" imageKey={null} onChange={onChange} />,
    );
    await fireEvent.press(getByTestId("f-pick"));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("uploads/new.jpg", "https://x/new.jpg"),
    );
    // onChange はアップロード完了の直後に呼ばれるが、hook 側の後片付け
    // （uploading → idle）はそのさらに後に走る。ここで流し切っておかないと
    // テスト終了後に state 更新が起きて act の警告になる。
    await act(async () => {});
  });

  // 親（フォーム）が onChange を受けて props を更新する動きを再現する。
  function Host() {
    const [image, setImage] = useState<{ key: string | null; url: string | null }>({
      key: null,
      url: null,
    });
    return (
      <ImagePickerField
        testID="f"
        imageKey={image.key}
        imageUrl={image.url}
        onChange={(key, url) => setImage({ key, url })}
      />
    );
  }

  // 完了のポップアップは本物の時計で 2 秒後に消える。本物の時計のままだと、CI の
  // ランナーが遅いときに確かめる前に消えて落ちる（PR #84 の CI で発生）。
  // 偽のタイマーではテストが進めない限り時間が経たないので、ランナーの速さに左右されない。
  // （waitFor は偽のタイマーを検出すると、確かめるたびに偽の時間を 50ms ずつ進める。）
  // 書き方は RecipeEditor.test.tsx と同じく、テストの中で有効にして finally で戻す。

  // サーバーは `POST /images` で表示用 URL も返す。これを捨てていたため
  // 「選んだのに画像が出ず『画像を設定しました』の文字だけ」だった（#40 で修正）。
  it("選んだ画像がその場でプレビューに出る", async () => {
    jest.useFakeTimers();
    try {
      pickSucceeds();
      mockUpload.mockResolvedValue({ key: "uploads/new.jpg", url: "https://x/new.jpg" });

      const { getByTestId } = await render(<Host />);
      await fireEvent.press(getByTestId("f-pick"));

      const preview = await waitFor(() => getByTestId("f-preview"));
      // expo-image は source を配列に正規化するので、中身を取り出して比べる。
      expect(preview.props.source).toEqual([{ uri: "https://x/new.jpg" }]);
      // 完了を知らせるポップアップも出る（プレビューに重ねて表示し、自動で消える）。
      expect(getByTestId("f-toast")).toBeTruthy();
      await act(async () => {});
    } finally {
      jest.useRealTimers();
    }
  });

  it("完了のポップアップは 2 秒で自動的に消える", async () => {
    jest.useFakeTimers();
    try {
      pickSucceeds();
      mockUpload.mockResolvedValue({ key: "uploads/new.jpg", url: "https://x/new.jpg" });

      const { getByTestId, queryByTestId } = await render(<Host />);
      await fireEvent.press(getByTestId("f-pick"));
      await waitFor(() => getByTestId("f-toast"));

      // 2000ms は ImagePickerField.tsx の TOAST_MS。waitFor はポップアップを見つけるまでに
      // 偽の時間を最大 50ms 進めるので、境界の前後に余裕を持たせて確かめる。
      // 表示から 1900〜1950ms 経った時点ではまだ出ている。
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1900);
      });
      expect(getByTestId("f-toast")).toBeTruthy();

      // 表示から 2000〜2050ms 経ったら消えている。
      await act(async () => {
        await jest.advanceTimersByTimeAsync(100);
      });
      expect(queryByTestId("f-toast")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("アップロード中はスピナーを出し、終わったら消える", async () => {
    pickSucceeds();
    // アップロードの解決を保留し、その間の表示（＝「中」の状態）を観測する。
    let resolve!: (v: { key: string; url: string }) => void;
    mockUpload.mockReturnValue(
      new Promise<{ key: string; url: string }>((r) => {
        resolve = r;
      }),
    );

    const { getByTestId, queryByTestId } = await render(
      <ImagePickerField testID="f" imageKey={null} onChange={jest.fn()} />,
    );

    // press を `await` すると、アップロードが解決していないので先へ進めない。
    // 押した「あと」の状態を観測したいので、完了は待たずに投げっぱなしにする
    // （`fireEvent.press` の Promise を await すると RNTL 内部の act が先に
    // 終了してしまい、その後の state 更新が act の外と判定される）。
    await act(async () => {
      void fireEvent.press(getByTestId("f-pick"));
    });

    await waitFor(() => expect(getByTestId("f-spinner")).toBeTruthy());

    // 解決に伴う state 更新（uploading → idle）は React の外から起きるので、
    // `act` で包んで「この間の更新をまとめて反映する」と React に伝える。
    await act(async () => {
      resolve({ key: "uploads/new.jpg", url: "https://x/new.jpg" });
    });

    await waitFor(() => expect(queryByTestId("f-spinner")).toBeNull());
  });
});

// 「選ぶ」と「送る」を 1 つの状態にまとめていたため、写真を探している間ずっと
// 「アップロード中…」と出てボタンも押せなくなる不具合があった（#40 で修正）。
describe("画像を選んでいる間", () => {
  /** ピッカーが解決しない状態（選択画面が開いたまま）を作る。 */
  function pickerStaysOpen() {
    mockLaunchLibrary.mockReturnValue(new Promise(() => {}));
  }

  it("「アップロード中」とは表示せず、案内文を出す", async () => {
    pickerStaysOpen();

    const { getByTestId, queryByTestId } = await render(
      <ImagePickerField testID="f" imageKey={null} onChange={jest.fn()} />,
    );
    await act(async () => {
      void fireEvent.press(getByTestId("f-pick"));
    });

    await waitFor(() => expect(getByTestId("f-picking")).toBeTruthy());
    // 通信はまだ何もしていないので、スピナーもアップロード API 呼び出しも無い。
    expect(queryByTestId("f-spinner")).toBeNull();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("ボタンは押せるままにして、選び直せるようにする", async () => {
    pickerStaysOpen();

    const { getByTestId, getByText } = await render(
      <ImagePickerField testID="f" imageKey={null} onChange={jest.fn()} />,
    );
    await act(async () => {
      void fireEvent.press(getByTestId("f-pick"));
    });

    await waitFor(() => expect(getByTestId("f-picking")).toBeTruthy());
    // 選択画面から戻れないときの唯一の復帰手段なので、無効化してはいけない。
    expect(getByTestId("f-pick").props.accessibilityState?.disabled).toBeFalsy();
    expect(getByText("画像を選び直す")).toBeTruthy();

    // 押し直すと新しい選択が始まる。
    await act(async () => {
      void fireEvent.press(getByTestId("f-pick"));
    });
    await waitFor(() => expect(mockLaunchLibrary).toHaveBeenCalledTimes(2));
  });

  it("押し直した後に古い選択が返ってきても、それは反映しない", async () => {
    // 1 回目は解決を保留、2 回目はキャンセルにする。
    let resolveFirst!: (v: unknown) => void;
    mockLaunchLibrary
      .mockReturnValueOnce(
        new Promise((r) => {
          resolveFirst = r;
        }),
      )
      .mockResolvedValueOnce({ canceled: true, assets: null });
    mockUpload.mockResolvedValue({ key: "uploads/old.jpg", url: "https://x/old.jpg" });
    const onChange = jest.fn();

    const { getByTestId, queryByTestId } = await render(
      <ImagePickerField testID="f" imageKey={null} onChange={onChange} />,
    );
    await act(async () => {
      void fireEvent.press(getByTestId("f-pick"));
    });
    await waitFor(() => expect(getByTestId("f-picking")).toBeTruthy());

    await act(async () => {
      await fireEvent.press(getByTestId("f-pick")); // 選び直す（2 回目が最新になる）
    });
    // 2 回目はキャンセルなので選択中表示が消える。ここまで待つことで、
    // 後片付けの state 更新がテスト終了後に走らないようにする。
    await waitFor(() => expect(queryByTestId("f-picking")).toBeNull());

    // 1 回目が遅れて「選ばれた」で返ってくる。
    await act(async () => {
      resolveFirst({
        canceled: false,
        assets: [{ uri: "file:///tmp/old.jpg", width: 100, height: 100 }],
      });
    });

    // 古い試行なので、アップロードもキーの反映も起きない。
    expect(mockUpload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("選択済みの状態", () => {
  it("URL があればプレビューを出し、変更 / 削除を出す", async () => {
    const { getByTestId, getByText } = await render(
      <ImagePickerField
        testID="f"
        imageKey="uploads/a.jpg"
        imageUrl="https://x/a.jpg"
        onChange={jest.fn()}
      />,
    );

    expect(getByTestId("f-preview")).toBeTruthy();
    expect(getByTestId("f-preview").props.contentFit).toBe("contain");
    expect(getByText("画像を変更")).toBeTruthy();
    expect(getByTestId("f-remove")).toBeTruthy();
  });

  it("画像を選択中は削除を無効にし、選択結果が削除で上書きされない", async () => {
    // 選択画面が開いたままの間に削除できると、あとから返る古い選択結果で
    // 消したはずの画像が復活するため、削除ボタンを押せないようにする。
    let resolvePicker!: (value: unknown) => void;
    mockLaunchLibrary.mockReturnValue(
      new Promise((resolve) => {
        resolvePicker = resolve;
      }),
    );
    const onChange = jest.fn();
    const { getByTestId, queryByTestId } = await render(
      <ImagePickerField
        testID="f"
        imageKey="uploads/a.jpg"
        imageUrl="https://x/a.jpg"
        onChange={onChange}
      />,
    );

    await act(async () => {
      void fireEvent.press(getByTestId("f-pick"));
    });
    await waitFor(() => expect(getByTestId("f-picking")).toBeTruthy());

    const remove = getByTestId("f-remove");
    expect(remove.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(remove);
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => {
      resolvePicker({ canceled: true, assets: null });
    });
    await waitFor(() => expect(queryByTestId("f-picking")).toBeNull());
  });

  it("URL が無ければ画像なし扱いにする（表示できないため）", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ImagePickerField testID="f" imageKey="uploads/a.jpg" onChange={jest.fn()} />,
    );

    expect(getByTestId("f-placeholder")).toBeTruthy();
    expect(queryByTestId("f-preview")).toBeNull();
  });

  it("削除を押すと onChange(null) を返す", async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <ImagePickerField
        testID="f"
        imageKey="uploads/a.jpg"
        imageUrl="https://x/a.jpg"
        onChange={onChange}
      />,
    );

    await fireEvent.press(getByTestId("f-remove"));
    expect(onChange).toHaveBeenCalledWith(null, null);
  });
});

describe("失敗したとき", () => {
  it("サーバーの 400 メッセージをそのまま出し、キーは変えない", async () => {
    pickSucceeds();
    mockUpload.mockRejectedValue(
      new ApiError("画像は 1 枚あたり 5MB までです", "VALIDATION_ERROR", 400, null),
    );
    const onChange = jest.fn();

    const { getByTestId, queryByTestId } = await render(
      <ImagePickerField testID="f" imageKey={null} onChange={onChange} />,
    );
    await fireEvent.press(getByTestId("f-pick"));

    await waitFor(() =>
      expect(getByTestId("f-error")).toHaveTextContent("画像は 1 枚あたり 5MB までです"),
    );
    expect(onChange).not.toHaveBeenCalled();
    // 後片付け（uploading → idle）までテスト内で終わらせる。
    await waitFor(() => expect(queryByTestId("f-spinner")).toBeNull());
  });

  it("権限が拒否されたら理由を出し、アップロードは呼ばない", async () => {
    mockRequestPermission.mockResolvedValue({ granted: false, status: "denied" });

    const { getByTestId, queryByTestId } = await render(
      <ImagePickerField testID="f" imageKey={null} onChange={jest.fn()} />,
    );
    await fireEvent.press(getByTestId("f-pick"));

    await waitFor(() => expect(getByTestId("f-error")).toBeTruthy());
    expect(mockUpload).not.toHaveBeenCalled();
    await waitFor(() => expect(queryByTestId("f-picking")).toBeNull());
  });

  it("キャンセルはエラーにせず、既存のキーも消さない", async () => {
    const onChange = jest.fn();
    const { getByTestId, queryByTestId } = await render(
      <ImagePickerField
        testID="f"
        imageKey="uploads/a.jpg"
        imageUrl="https://x/a.jpg"
        onChange={onChange}
      />,
    );

    await fireEvent.press(getByTestId("f-pick"));

    await waitFor(() => expect(mockLaunchLibrary).toHaveBeenCalled());
    // キャンセルで選択中表示が消えるところまで待つ（後片付けの取りこぼし防止）。
    await waitFor(() => expect(queryByTestId("f-picking")).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    expect(queryByTestId("f-error")).toBeNull();
  });
});
