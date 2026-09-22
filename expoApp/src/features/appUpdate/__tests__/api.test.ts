import { checkForUpdate } from "../api";

const mockGetCurrentAppVersion = jest.fn();

jest.mock("../config", () => ({
  getCurrentAppVersion: () => mockGetCurrentAppVersion(),
  getReleasesApiUrl: () => "https://api.github.com/repos/owner/repo/releases/latest",
}));

const originalFetch = global.fetch;

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    ...response,
  });
}

beforeEach(() => {
  mockGetCurrentAppVersion.mockReset();
  mockGetCurrentAppVersion.mockResolvedValue("1.0.0");
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe("checkForUpdate", () => {
  it("新しいバージョンがあればupdateAvailableとReleaseInfoを返す", async () => {
    mockFetchOnce({
      json: async () => ({
        tag_name: "v1.2.3",
        name: "v1.2.3 リリース",
        published_at: "2026-01-01T00:00:00Z",
        html_url: "https://github.com/owner/repo/releases/tag/v1.2.3",
        assets: [
          { name: "app.msi", browser_download_url: "https://example.com/app.msi" },
          { name: "app.apk", browser_download_url: "https://example.com/app.apk" },
        ],
      }),
    });

    const result = await checkForUpdate();

    expect(result.state).toBe("updateAvailable");
    expect(result.release).toEqual({
      version: "1.2.3",
      title: "v1.2.3 リリース",
      publishedAt: "2026-01-01T00:00:00Z",
      bodyUrl: "https://github.com/owner/repo/releases/tag/v1.2.3",
      assets: { msiUrl: "https://example.com/app.msi", apkUrl: "https://example.com/app.apk" },
    });
  });

  it("現在と同じバージョンならupToDateを返す", async () => {
    mockFetchOnce({
      json: async () => ({
        tag_name: "v1.0.0",
        html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
      }),
    });

    const result = await checkForUpdate();
    expect(result.state).toBe("upToDate");
  });

  it("現在より古いバージョンならupToDateを返す", async () => {
    mockFetchOnce({
      json: async () => ({
        tag_name: "v0.9.0",
        html_url: "https://github.com/owner/repo/releases/tag/v0.9.0",
      }),
    });

    const result = await checkForUpdate();
    expect(result.state).toBe("upToDate");
  });

  it("Releaseが1つも無い（404）場合はupToDateを返す", async () => {
    mockFetchOnce({ ok: false, status: 404 });
    const result = await checkForUpdate();
    expect(result.state).toBe("upToDate");
  });

  it("レート制限（403等）ではcheckFailedを返す", async () => {
    mockFetchOnce({ ok: false, status: 403 });
    const result = await checkForUpdate();
    expect(result.state).toBe("checkFailed");
  });

  it("不正なレスポンス（tag_nameが無い）ではcheckFailedを返す", async () => {
    mockFetchOnce({ json: async () => ({ foo: "bar" }) });
    const result = await checkForUpdate();
    expect(result.state).toBe("checkFailed");
  });

  it("通信自体が失敗した場合はcheckFailedを返す（例外を投げない）", async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await checkForUpdate();
    expect(result.state).toBe("checkFailed");
  });

  it("JSONのパースに失敗した場合はcheckFailedを返す", async () => {
    mockFetchOnce({
      json: async () => {
        throw new SyntaxError("invalid json");
      },
    });
    const result = await checkForUpdate();
    expect(result.state).toBe("checkFailed");
  });
});
