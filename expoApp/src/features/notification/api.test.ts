import { api } from "@/api/client";

import { getUnreadCount, listNotifications, markNotificationsRead } from "./api";

jest.mock("@/api/client", () => ({ api: { GET: jest.fn(), POST: jest.fn() } }));

const mockGet = api.GET as jest.Mock;
const mockPost = api.POST as jest.Mock;

beforeEach(() => jest.clearAllMocks());

it("通知一覧をcursorとlimit付きで取得する", async () => {
  const data = { items: [], unreadCount: 0, nextCursor: null };
  mockGet.mockResolvedValue({ data, response: { ok: true, status: 200 } });
  await expect(listNotifications({ cursor: "next", limit: 20 })).resolves.toEqual(data);
  expect(mockGet).toHaveBeenCalledWith("/api/v1/notifications", {
    params: { query: { cursor: "next", limit: 20 } },
  });
});

it("未読件数を取得する", async () => {
  mockGet.mockResolvedValue({ data: { unreadCount: 4 }, response: { ok: true, status: 200 } });
  await expect(getUnreadCount()).resolves.toEqual({ unreadCount: 4 });
  expect(mockGet).toHaveBeenCalledWith("/api/v1/notifications/unread-count");
});

it("個別既読と全件既読を正しいbodyで送る", async () => {
  mockPost.mockResolvedValue({ response: { ok: true, status: 204 } });
  await markNotificationsRead(["n1"]);
  expect(mockPost).toHaveBeenLastCalledWith("/api/v1/notifications/read", {
    body: { ids: ["n1"] },
  });
  await markNotificationsRead();
  expect(mockPost).toHaveBeenLastCalledWith("/api/v1/notifications/read");
});

it("本文の無い非2xxも失敗にする", async () => {
  mockPost.mockResolvedValue({ response: { ok: false, status: 502 } });
  await expect(markNotificationsRead(["n1"])).rejects.toMatchObject({ status: 502 });
});
