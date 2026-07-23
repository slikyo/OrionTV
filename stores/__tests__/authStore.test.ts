import { api } from "@/services/api";
import { LoginCredentialsManager } from "@/services/storage";
import { useSettingsStore } from "@/stores/settingsStore";
import useAuthStore, { allowAutoLogin } from "@/stores/authStore";

jest.mock("@/services/api", () => ({
  api: {
    hasAuthCookies: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    clearAuthCookies: jest.fn(),
  },
}));

jest.mock("@/services/storage", () => ({
  LoginCredentialsManager: {
    get: jest.fn(),
  },
}));

jest.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: jest.fn(),
  },
}));

jest.mock("react-native-toast-message", () => ({
  __esModule: true,
  default: { show: jest.fn() },
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

const mockedApi = api as unknown as {
  hasAuthCookies: jest.Mock;
  login: jest.Mock;
  logout: jest.Mock;
  clearAuthCookies: jest.Mock;
};
const mockedCredentials = LoginCredentialsManager as unknown as {
  get: jest.Mock;
};
const mockedSettingsStore = useSettingsStore as unknown as {
  getState: jest.Mock;
};

describe("authStore cold-start restoration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    allowAutoLogin();
    useAuthStore.setState({ isLoggedIn: false, isLoginModalVisible: false });
    mockedSettingsStore.getState.mockReturnValue({
      serverConfig: { SiteName: "MoonTVPlus", StorageType: "localstorage" },
      isLoadingServerConfig: false,
    });
    mockedApi.hasAuthCookies.mockResolvedValue(false);
  });

  it("reuses the saved localstorage password when migrating from a missing cookie", async () => {
    mockedCredentials.get.mockResolvedValue({ username: "", password: "secret" });
    mockedApi.login.mockImplementation(async (_username?: string, password?: string) => {
      if (password !== "secret") {
        throw new Error("HTTP error! status: 400");
      }
      return { ok: true, token: "new-token" };
    });

    await useAuthStore.getState().checkLoginStatus("https://moon.example.com");

    expect(mockedApi.login).toHaveBeenCalledWith(undefined, "secret");
    expect(useAuthStore.getState()).toMatchObject({
      isLoggedIn: true,
      isLoginModalVisible: false,
    });
  });

  it("still supports a passwordless localstorage server without saved credentials", async () => {
    mockedCredentials.get.mockResolvedValue(null);
    mockedApi.login.mockResolvedValue({ ok: true });

    await useAuthStore.getState().checkLoginStatus("https://moon.example.com");

    expect(mockedApi.login).toHaveBeenCalledWith();
    expect(useAuthStore.getState()).toMatchObject({
      isLoggedIn: true,
      isLoginModalVisible: false,
    });
  });

  it("waits when server config starts loading just after the first state read", async () => {
    jest.useFakeTimers();

    try {
      const serverConfig = { SiteName: "MoonTVPlus", StorageType: "redis" };
      mockedSettingsStore.getState
        .mockReturnValueOnce({ serverConfig: null, isLoadingServerConfig: false })
        .mockReturnValueOnce({ serverConfig: null, isLoadingServerConfig: true })
        .mockReturnValue({ serverConfig, isLoadingServerConfig: false });
      mockedCredentials.get.mockResolvedValue({ username: "arthur", password: "secret" });
      mockedApi.login.mockResolvedValue({ ok: true, token: "new-token" });

      const loginCheck = useAuthStore
        .getState()
        .checkLoginStatus("https://moon.example.com");

      await jest.runAllTimersAsync();
      await loginCheck;

      expect(mockedApi.login).toHaveBeenCalledWith("arthur", "secret");
      expect(useAuthStore.getState()).toMatchObject({
        isLoggedIn: true,
        isLoginModalVisible: false,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("waits while server config is already loading", async () => {
    jest.useFakeTimers();

    try {
      const serverConfig = { SiteName: "MoonTVPlus", StorageType: "redis" };
      mockedSettingsStore.getState
        .mockReturnValueOnce({ serverConfig: null, isLoadingServerConfig: true })
        .mockReturnValue({ serverConfig, isLoadingServerConfig: false });
      mockedCredentials.get.mockResolvedValue({ username: "arthur", password: "secret" });
      mockedApi.login.mockResolvedValue({ ok: true, token: "new-token" });

      const loginCheck = useAuthStore
        .getState()
        .checkLoginStatus("https://moon.example.com");

      await jest.runAllTimersAsync();
      await loginCheck;

      expect(mockedApi.login).toHaveBeenCalledWith("arthur", "secret");
      expect(useAuthStore.getState()).toMatchObject({
        isLoggedIn: true,
        isLoginModalVisible: false,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops waiting when server config loading finishes without a config", async () => {
    jest.useFakeTimers();

    try {
      mockedSettingsStore.getState
        .mockReturnValueOnce({ serverConfig: null, isLoadingServerConfig: true })
        .mockReturnValue({ serverConfig: null, isLoadingServerConfig: false });

      const loginCheck = useAuthStore
        .getState()
        .checkLoginStatus("https://moon.example.com");

      await jest.runAllTimersAsync();
      await loginCheck;

      expect(mockedApi.login).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("bounds a missing-config wait and allows a later login check to retry", async () => {
    jest.useFakeTimers();

    try {
      mockedSettingsStore.getState.mockReturnValue({
        serverConfig: null,
        isLoadingServerConfig: false,
      });

      const timedOutCheck = useAuthStore
        .getState()
        .checkLoginStatus("https://moon.example.com");

      await jest.advanceTimersByTimeAsync(3000);
      await timedOutCheck;

      expect(mockedApi.login).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);

      mockedSettingsStore.getState.mockReturnValue({
        serverConfig: { SiteName: "MoonTVPlus", StorageType: "redis" },
        isLoadingServerConfig: false,
      });
      mockedCredentials.get.mockResolvedValue({ username: "arthur", password: "secret" });
      mockedApi.login.mockResolvedValue({ ok: true, token: "new-token" });

      await useAuthStore.getState().checkLoginStatus("https://moon.example.com");

      expect(mockedApi.login).toHaveBeenCalledTimes(1);
      expect(mockedApi.login).toHaveBeenCalledWith("arthur", "secret");
      expect(useAuthStore.getState()).toMatchObject({
        isLoggedIn: true,
        isLoginModalVisible: false,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("deduplicates concurrent login checks", async () => {
    mockedSettingsStore.getState.mockReturnValue({
      serverConfig: { SiteName: "MoonTVPlus", StorageType: "redis" },
      isLoadingServerConfig: false,
    });
    mockedCredentials.get.mockResolvedValue({ username: "arthur", password: "secret" });
    mockedApi.login.mockResolvedValue({ ok: true, token: "new-token" });

    const firstCheck = useAuthStore
      .getState()
      .checkLoginStatus("https://moon.example.com");
    const secondCheck = useAuthStore
      .getState()
      .checkLoginStatus("https://moon.example.com");

    await Promise.all([firstCheck, secondCheck]);

    expect(mockedApi.hasAuthCookies).toHaveBeenCalledTimes(1);
    expect(mockedCredentials.get).toHaveBeenCalledTimes(1);
    expect(mockedApi.login).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({
      isLoggedIn: true,
      isLoginModalVisible: false,
    });
  });

  it("does not let an empty-url startup check suppress a configured-url check", async () => {
    mockedSettingsStore.getState.mockReturnValue({
      serverConfig: { SiteName: "MoonTVPlus", StorageType: "redis" },
      isLoadingServerConfig: false,
    });
    mockedCredentials.get.mockResolvedValue({ username: "arthur", password: "secret" });
    mockedApi.login.mockResolvedValue({ ok: true, token: "new-token" });

    const emptyUrlCheck = useAuthStore.getState().checkLoginStatus();
    const configuredUrlCheck = useAuthStore.getState().checkLoginStatus("https://moon.example.com");

    await Promise.all([emptyUrlCheck, configuredUrlCheck]);

    expect(mockedApi.login).toHaveBeenCalledWith("arthur", "secret");
    expect(useAuthStore.getState()).toMatchObject({
      isLoggedIn: true,
      isLoginModalVisible: false,
    });
  });
});
