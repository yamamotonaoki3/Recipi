import { useUnsavedChangesStore } from "./unsavedChanges";

function clearRequestClose() {
  const requestClose = useUnsavedChangesStore.getState().requestClose;
  if (requestClose) {
    useUnsavedChangesStore.getState().clearRequestClose(requestClose);
  }
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
