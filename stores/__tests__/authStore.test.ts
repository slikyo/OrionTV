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
