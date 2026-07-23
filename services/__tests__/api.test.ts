import AsyncStorage from "@react-native-async-storage/async-storage";
import CookieManager from "@react-native-cookies/cookies";
import { API } from "@/services/api";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock("@react-native-cookies/cookies", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    clearAll: jest.fn(),
    flush: jest.fn(),
    setFromResponse: jest.fn(),
  },
}));

jest.mock("@/utils/Logger", () => ({
  __esModule: true,
  default: {
    withTag: () => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockedCookieManager = CookieManager as typeof CookieManager & {
  get: jest.Mock;
  set: jest.Mock;
  clearAll: jest.Mock;
  flush: jest.Mock;
  setFromResponse: jest.Mock;
};

const createJsonResponse = (
  body: unknown,
  options: { status?: number; setCookie?: string } = {}
): Response => {
  const status = options.status ?? 200;
  const setCookie = options.setCookie;

  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: jest.fn((name: string) =>
        name.toLowerCase() === "set-cookie" ? setCookie ?? null : null
      ),
      forEach: jest.fn((callback: (value: string, key: string) => void) => {
        if (setCookie) {
          callback(setCookie, "set-cookie");
        }
      }),
    },
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
};

describe("API MoonTVPlus authentication", () => {
  const baseURL = "https://moon.example.com";
  const storage = new Map<string, string>();
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    storage.clear();

    mockedAsyncStorage.getItem.mockImplementation(async (key: string) => storage.get(key) ?? null);
    mockedAsyncStorage.setItem.mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
    });
    mockedAsyncStorage.removeItem.mockImplementation(async (key: string) => {
      storage.delete(key);
    });

    mockedCookieManager.get.mockResolvedValue({});
    mockedCookieManager.set.mockResolvedValue(true);
    mockedCookieManager.clearAll.mockResolvedValue(true);
    mockedCookieManager.flush.mockResolvedValue(true);
    mockedCookieManager.setFromResponse.mockResolvedValue(true);

    fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
  });

  it("persists the auth cookie from the login JSON token when Set-Cookie is unreadable", async () => {
    const token = "%7B%22username%22%3A%22alice%22%2C%22signature%22%3A%22a%3Db%22%7D";
    fetchMock.mockResolvedValueOnce(createJsonResponse({ ok: true, token }));

    const api = new API(baseURL);
    await api.login("alice", "secret");

    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith("authCookies", `auth=${token}`);
    expect(mockedCookieManager.set).toHaveBeenCalledWith(
      baseURL,
      expect.objectContaining({ name: "auth", value: token, path: "/" }),
      true
    );
  });

  it("keeps manual username and password login behavior", async () => {
    const token = "%7B%22username%22%3A%22alice%22%7D";
    fetchMock.mockResolvedValueOnce(createJsonResponse({ ok: true, token }));

    const api = new API(baseURL);

    await expect(api.login("alice", "secret")).resolves.toEqual({ ok: true, token });
    expect(fetchMock).toHaveBeenCalledWith(
      `${baseURL}/api/login`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "secret" }),
      })
    );
  });

  it("sends the persisted JSON token on the first authenticated request after login", async () => {
    const token = "%7B%22username%22%3A%22alice%22%7D";
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ ok: true, token }))
      .mockResolvedValueOnce(createJsonResponse({ results: [] }));

    const api = new API(baseURL);
    await api.login("alice", "secret");
    await api.searchVideos("test");

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${baseURL}/api/search?q=test`,
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: `auth=${token}` }),
      })
    );
  });

  it("restores auth from AsyncStorage even when native storage contains an unrelated cookie", async () => {
    const token = "%7B%22username%22%3A%22alice%22%7D";
    storage.set("authCookies", `auth=${token}`);
    mockedCookieManager.get.mockResolvedValue({
      theme: { name: "theme", value: "dark" },
    });
    fetchMock.mockResolvedValueOnce(createJsonResponse({ results: [] }));

    const api = new API(baseURL);
    await api.searchVideos("cold start");

    expect(fetchMock).toHaveBeenCalledWith(
      `${baseURL}/api/search?q=cold%20start`,
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: `auth=${token}` }),
      })
    );
  });

  it("does not treat unrelated cookies as an authenticated session", async () => {
    mockedCookieManager.get.mockResolvedValue({
      theme: { name: "theme", value: "dark" },
    });
    storage.set("authCookies", "locale=zh-CN");

    const api = new API(baseURL);

    await expect(api.hasAuthCookies()).resolves.toBe(false);
  });

  it("rejects a credential login that does not establish an auth session", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({ ok: true }));

    const api = new API(baseURL);

    await expect(api.login("alice", "secret")).rejects.toThrow("AUTH_SESSION_NOT_AVAILABLE");
  });

  it("allows an anonymous login response for a passwordless localstorage server", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({ ok: true }));

    const api = new API(baseURL);

    await expect(api.login()).resolves.toEqual({ ok: true });
  });

  it("keeps Set-Cookie as a compatibility fallback for older servers", async () => {
    const token = "legacy-token";
    fetchMock.mockResolvedValueOnce(
      createJsonResponse(
        { ok: true },
        { setCookie: `auth=${token}; Path=/; HttpOnly; SameSite=Lax` }
      )
    );

    const api = new API(baseURL);
    await api.login("alice", "secret");

    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith("authCookies", `auth=${token}`);
  });
});