import { create } from "zustand";
import { api } from "@/services/api";
import { LoginCredentialsManager } from "@/services/storage";
import { useSettingsStore } from "./settingsStore";
import Toast from "react-native-toast-message";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("AuthStore");

// 用户主动退出后，本次进程内不再自动登录
let suppressAutoLogin = false;
let checkLoginInFlight: Promise<void> | null = null;

export const allowAutoLogin = () => {
  suppressAutoLogin = false;
};

interface AuthState {
  isLoggedIn: boolean;
  isLoginModalVisible: boolean;
  showLoginModal: () => void;
  hideLoginModal: () => void;
  checkLoginStatus: (apiBaseUrl?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const waitForServerConfig = async () => {
  const settingsState = useSettingsStore.getState();
  let serverConfig = settingsState.serverConfig;

  if (settingsState.isLoadingServerConfig) {
    const maxWaitTime = 3000;
    const checkInterval = 100;
    let waitTime = 0;

    while (waitTime < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
      waitTime += checkInterval;
      const currentState = useSettingsStore.getState();
      if (!currentState.isLoadingServerConfig) {
        serverConfig = currentState.serverConfig;
        break;
      }
    }
  }

  return {
    serverConfig,
    isLoadingServerConfig: useSettingsStore.getState().isLoadingServerConfig,
  };
};

const tryRestoreSession = async (isLocalStorage: boolean): Promise<boolean> => {
  const credentials = await LoginCredentialsManager.get();

  if (isLocalStorage) {
    if (credentials?.password) {
      try {
        const loginResult = await api.login(undefined, credentials.password);
        return Boolean(loginResult?.ok);
      } catch (error) {
        // A password may have been removed from the server configuration. In that
        // case the credentialed request returns ok without an auth session, so
        // retry once as the supported passwordless localstorage flow.
        if (!(error instanceof Error) || error.message !== "AUTH_SESSION_NOT_AVAILABLE") {
          throw error;
        }
      }
    }

    const loginResult = await api.login();
    return Boolean(loginResult?.ok);
  }

  if (!credentials?.password) {
    return false;
  }

  const loginResult = await api.login(credentials.username || undefined, credentials.password);
  return Boolean(loginResult?.ok);
};

const useAuthStore = create<AuthState>((set) => ({
  isLoggedIn: false,
  isLoginModalVisible: false,
  showLoginModal: () => set({ isLoginModalVisible: true }),
  hideLoginModal: () => set({ isLoginModalVisible: false }),
  checkLoginStatus: async (apiBaseUrl?: string) => {
    // An early startup probe can run before settings have loaded. Do not let
    // that no-op check occupy the in-flight slot needed by the real URL check.
    if (!apiBaseUrl) {
      set({ isLoggedIn: false, isLoginModalVisible: false });
      return;
    }

    if (checkLoginInFlight) {
      return checkLoginInFlight;
    }

    checkLoginInFlight = (async () => {
      try {
        const { serverConfig, isLoadingServerConfig } = await waitForServerConfig();

        if (!serverConfig?.StorageType) {
          if (!isLoadingServerConfig) {
            Toast.show({ type: "error", text1: "请检查网络或者服务器地址是否可用" });
          }
          return;
        }

        const isLocalStorage = serverConfig.StorageType === "localstorage";
        const hasCookies = await api.hasAuthCookies();

        if (hasCookies) {
          set({ isLoggedIn: true, isLoginModalVisible: false });
          return;
        }

        // 无有效会话时：localstorage 静默登录；否则用已保存账号密码自动登录
        // 主动退出后本次进程内不自动登录
        if (!suppressAutoLogin) {
          try {
            const restored = await tryRestoreSession(isLocalStorage);
            if (restored) {
              set({ isLoggedIn: true, isLoginModalVisible: false });
              return;
            }
          } catch (error) {
            logger.warn("Auto login failed:", error);
          }
        }

        set({ isLoggedIn: false, isLoginModalVisible: true });
      } catch (error) {
        logger.error("Failed to check login status:", error);
        if (error instanceof Error && error.message === "UNAUTHORIZED") {
          set({ isLoggedIn: false, isLoginModalVisible: true });
        } else {
          set({ isLoggedIn: false });
        }
      }
    })();

    try {
      await checkLoginInFlight;
    } finally {
      checkLoginInFlight = null;
    }
  },
  logout: async () => {
    suppressAutoLogin = true;
    try {
      await api.logout();
    } catch (error) {
      logger.error("Failed to logout:", error);
      await api.clearAuthCookies();
    } finally {
      set({ isLoggedIn: false, isLoginModalVisible: true });
    }
  },
}));

export default useAuthStore;
