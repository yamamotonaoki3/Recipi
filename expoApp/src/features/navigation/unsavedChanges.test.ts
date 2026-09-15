import { useUnsavedChangesStore } from "./unsavedChanges";

function clearRequestClose() {
  const requestClose = useUnsavedChangesStore.getState().requestClose;
  if (requestClose) {
    useUnsavedChangesStore.getState().clearRequestClose(requestClose);
  }
  useUnsavedChangesStore.setState({ pendingByDestination: {} });
}

describe("useUnsavedChangesStore", () => {
  beforeEach(() => {
    clearRequestClose();
  });

  it("登録した requestClose を呼べる", () => {
    const requestClose = jest.fn();

    useUnsavedChangesStore.getState().registerRequestClose(requestClose);
    useUnsavedChangesStore.getState().requestClose?.();

    expect(requestClose).toHaveBeenCalledTimes(1);
  });

  it("登録した requestClose を解除できる", () => {
    const requestClose = jest.fn();

    useUnsavedChangesStore.getState().registerRequestClose(requestClose);
    useUnsavedChangesStore.getState().clearRequestClose(requestClose);

    expect(useUnsavedChangesStore.getState().requestClose).toBeNull();
  });
});

describe("pendingByDestination（裏に残った編集画面。Issue #156）", () => {
  beforeEach(() => {
    clearRequestClose();
  });

  it("destination ごとに登録して呼べる", () => {
    const requestClose = jest.fn();

    useUnsavedChangesStore.getState().registerPending("/my-page", requestClose);
    useUnsavedChangesStore.getState().pendingByDestination["/my-page"]?.();

    expect(requestClose).toHaveBeenCalledTimes(1);
    expect(useUnsavedChangesStore.getState().pendingByDestination["/home"]).toBeUndefined();
  });

  it("登録したものを解除できる", () => {
    const requestClose = jest.fn();

    useUnsavedChangesStore.getState().registerPending("/my-page", requestClose);
    useUnsavedChangesStore.getState().clearPending("/my-page", requestClose);

    expect(useUnsavedChangesStore.getState().pendingByDestination["/my-page"]).toBeUndefined();
  });

  it("別の関数で解除しようとしても、後から登録されたものは残す", () => {
    const older = jest.fn();
    const newer = jest.fn();

    useUnsavedChangesStore.getState().registerPending("/my-page", older);
    useUnsavedChangesStore.getState().registerPending("/my-page", newer);
    useUnsavedChangesStore.getState().clearPending("/my-page", older);

    expect(useUnsavedChangesStore.getState().pendingByDestination["/my-page"]).toBe(newer);
  });
});
