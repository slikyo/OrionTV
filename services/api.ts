import CookieManager from "@react-native-cookies/cookies";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("API");
const AUTH_COOKIES_KEY = "authCookies";
const AUTH_COOKIE_NAME = "auth";

// region: --- Interface Definitions ---
export interface DoubanItem {
  title: string;
  poster: string;
  rate?: string;
}

export interface DoubanResponse {
  code: number;
  message: string;
  list: DoubanItem[];
}

export interface VideoDetail {
  id: string;
  title: string;
  poster: string;
  source: string;
  source_name: string;
  desc?: string;
  type?: string;
  year?: string;
  area?: string;
  director?: string;
  actor?: string;
  remarks?: string;
}

export interface SearchResult {
  id: number;
  title: string;
  poster: string;
  episodes: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
}

export interface Favorite {
  cover: string;
  title: string;
  source_name: string;
  total_episodes: number;
  search_title: string;
  year: string;
  save_time?: number;
}

export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  index: number;
  total_episodes: number;
  play_time: number;
  total_time: number;
  save_time: number;
  year: string;
}

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

export interface ServerConfig {
  SiteName: string;
  StorageType: "localstorage" | "redis" | string;
}

export interface LoginResponse {
  ok: boolean;
  token?: string;
  auth?: Record<string, unknown>;
  error?: string;
}

export class API {
  public baseURL: string = "";
  private authCookieHeader: string = "";

  constructor(baseURL?: string) {
    if (baseURL) {
      this.baseURL = baseURL;
    }
  }

  public setBaseUrl(url: string) {
    if (url !== this.baseURL) {
      this.authCookieHeader = "";
    }
    this.baseURL = url;
  }

  private extractSetCookieHeaders(response: Response): string[] {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    if (typeof headers.getSetCookie === "function") {
      const list = headers.getSetCookie();
      if (list?.length) {
        return list;
      }
    }

    const single = headers.get("set-cookie") || headers.get("Set-Cookie");
    if (single) {
      return [single];
    }

    const cookies: string[] = [];
    headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() === "set-cookie") {
        cookies.push(value);
      }
    });
    return cookies;
  }

  private extractAuthCookieHeader(cookieHeader: string): string {
    const pairs = cookieHeader.split(";").map((part) => part.trim()).filter(Boolean);
    for (const pair of pairs) {
      const eq = pair.indexOf("=");
      if (eq <= 0 || pair.slice(0, eq).trim() !== AUTH_COOKIE_NAME) {
        continue;
      }

      const value = pair.slice(eq + 1).trim();
      return value ? `${AUTH_COOKIE_NAME}=${value}` : "";
    }
    return "";
  }

  private async cookieHeaderFromNative(url: string): Promise<string> {
    try {
      const nativeCookies = await CookieManager.get(url);
      const authEntry = Object.entries(nativeCookies).find(([key, value]) => {
        if (key === AUTH_COOKIE_NAME) {
          return true;
        }
        return Boolean(
          value &&
          typeof value === "object" &&
          "name" in value &&
          (value as { name?: string }).name === AUTH_COOKIE_NAME
        );
      });

      if (!authEntry) {
        return "";
      }

      const value = authEntry[1];
      if (!value || typeof value !== "object" || !("value" in value)) {
        return "";
      }

      const authValue = (value as { value?: string }).value;
      return authValue ? `${AUTH_COOKIE_NAME}=${authValue}` : "";
    } catch (error) {
      logger.warn("Failed to read native auth cookie:", error);
      return "";
    }
  }

  private async getAuthCookieHeader(url: string): Promise<string> {
    if (this.authCookieHeader) {
      return this.authCookieHeader;
    }

    const nativeHeader = await this.cookieHeaderFromNative(url);
    if (nativeHeader) {
      this.authCookieHeader = nativeHeader;
      try {
        await AsyncStorage.setItem(AUTH_COOKIES_KEY, nativeHeader);
      } catch (error) {
        logger.warn("Failed to back up native auth cookie:", error);
      }
      return nativeHeader;
    }

    try {
      const stored = await AsyncStorage.getItem(AUTH_COOKIES_KEY);
      const storedAuthHeader = stored ? this.extractAuthCookieHeader(stored) : "";
      if (storedAuthHeader) {
        this.authCookieHeader = storedAuthHeader;
        if (storedAuthHeader !== stored) {
          await AsyncStorage.setItem(AUTH_COOKIES_KEY, storedAuthHeader);
        }
        await this.restoreStoredCookies(storedAuthHeader);
        return storedAuthHeader;
      }
      if (stored) {
        await AsyncStorage.removeItem(AUTH_COOKIES_KEY);
      }
    } catch (error) {
      logger.warn("Failed to read stored auth cookie:", error);
    }
    return "";
  }

  private async restoreStoredCookies(cookieHeader: string): Promise<void> {
    if (!this.baseURL) {
      return;
    }

    const authHeader = this.extractAuthCookieHeader(cookieHeader);
    if (!authHeader) {
      return;
    }

    const eq = authHeader.indexOf("=");
    const value = authHeader.slice(eq + 1);
    try {
      await CookieManager.set(
        this.baseURL,
        {
          name: AUTH_COOKIE_NAME,
          value,
          path: "/",
        },
        true
      );
    } catch (error) {
      logger.warn("Failed to restore auth cookie:", error);
    }
  }

  private async flushNativeCookies(): Promise<void> {
    try {
      if (typeof (CookieManager as any).flush === "function") {
        await (CookieManager as any).flush();
      }
    } catch (error) {
      logger.warn("CookieManager.flush failed:", error);
    }
  }

  private async persistAuthToken(token: string): Promise<void> {
    if (!token) {
      return;
    }

    const cookieHeader = `${AUTH_COOKIE_NAME}=${token}`;
    this.authCookieHeader = cookieHeader;

    try {
      await AsyncStorage.setItem(AUTH_COOKIES_KEY, cookieHeader);
    } catch (error) {
      logger.warn("Failed to persist login token:", error);
    }

    try {
      await CookieManager.set(
        this.baseURL,
        {
          name: AUTH_COOKIE_NAME,
          value: token,
          path: "/",
        },
        true
      );
    } catch (error) {
      logger.warn("Failed to set native auth cookie from login token:", error);
    }

    await this.flushNativeCookies();
  }

  private async persistCookiesFromResponse(url: string, response: Response): Promise<void> {
    const setCookies = this.extractSetCookieHeaders(response);
    let responseAuthHeader = "";
    let authWasCleared = false;

    for (const raw of setCookies) {
      const segments = raw.split(";").map((part) => part.trim()).filter(Boolean);
      if (segments.length === 0) {
        continue;
      }

      const [nameValue, ...attrs] = segments;
      const eq = nameValue.indexOf("=");
      if (eq <= 0) {
        continue;
      }

      const name = nameValue.slice(0, eq).trim();
      if (name !== AUTH_COOKIE_NAME) {
        continue;
      }

      const value = nameValue.slice(eq + 1).trim();
      authWasCleared = !value;
      if (value) {
        responseAuthHeader = `${AUTH_COOKIE_NAME}=${value}`;
      }

      try {
        if (typeof (CookieManager as any).setFromResponse === "function") {
          await (CookieManager as any).setFromResponse(url, raw);
        }
      } catch (error) {
        logger.warn("setFromResponse failed:", error);
      }

      if (!value) {
        continue;
      }

      const cookie: {
        name: string;
        value: string;
        path?: string;
        domain?: string;
        expires?: string;
        secure?: boolean;
        httpOnly?: boolean;
      } = {
        name: AUTH_COOKIE_NAME,
        value,
        path: "/",
      };

      for (const attr of attrs) {
        const attrEq = attr.indexOf("=");
        const key = (attrEq >= 0 ? attr.slice(0, attrEq) : attr).trim().toLowerCase();
        const attrValue = attrEq >= 0 ? attr.slice(attrEq + 1).trim() : undefined;
        if (key === "path" && attrValue) {
          cookie.path = attrValue;
        } else if (key === "domain" && attrValue) {
          cookie.domain = attrValue;
        } else if (key === "expires" && attrValue) {
          cookie.expires = attrValue;
        } else if (key === "secure") {
          cookie.secure = true;
        } else if (key === "httponly") {
          cookie.httpOnly = true;
        }
      }

      try {
        await CookieManager.set(url, cookie, true);
      } catch (error) {
        logger.warn("Failed to set native auth cookie:", error);
      }
    }

    if (!responseAuthHeader && !authWasCleared) {
      responseAuthHeader = await this.cookieHeaderFromNative(url);
    }

    if (responseAuthHeader) {
      this.authCookieHeader = responseAuthHeader;
      try {
        await AsyncStorage.setItem(AUTH_COOKIES_KEY, responseAuthHeader);
      } catch (error) {
        logger.warn("Failed to persist auth cookie:", error);
      }
    } else if (authWasCleared) {
      this.authCookieHeader = "";
      try {
        await AsyncStorage.removeItem(AUTH_COOKIES_KEY);
      } catch (error) {
        logger.warn("Failed to clear stored auth cookie:", error);
      }
    }

    await this.flushNativeCookies();
  }

  async clearAuthCookies(): Promise<void> {
    this.authCookieHeader = "";
    try {
      await CookieManager.clearAll(true);
    } catch (error) {
      logger.warn("Failed to clear native cookies:", error);
    }
    try {
      await AsyncStorage.removeItem(AUTH_COOKIES_KEY);
    } catch (error) {
      logger.warn("Failed to clear stored auth cookie:", error);
    }
  }

  async hasAuthCookies(): Promise<boolean> {
    if (!this.baseURL) {
      return false;
    }
    const header = await this.getAuthCookieHeader(this.baseURL);
    return Boolean(this.extractAuthCookieHeader(header));
  }

  private async _rawFetch(url: string, options: RequestInit = {}): Promise<Response> {
    if (!this.baseURL) {
      throw new Error("API_URL_NOT_SET");
    }

    const fullUrl = `${this.baseURL}${url}`;
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    };

    const cookieHeader = await this.getAuthCookieHeader(fullUrl);
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    const response = await fetch(fullUrl, {
      ...options,
      headers,
      credentials: "include",
    });

    await this.persistCookiesFromResponse(this.baseURL, response);
    return response;
  }

  private async _fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const response = await this._rawFetch(url, options);

    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response;
  }

  async login(username?: string | undefined, password?: string): Promise<LoginResponse> {
    // 登录请求不要带旧 cookie，避免干扰新会话
    if (!this.baseURL) {
      throw new Error("API_URL_NOT_SET");
    }

    const fullUrl = `${this.baseURL}/api/login`;
    const response = await fetch(fullUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      credentials: "include",
    });

    await this.persistCookiesFromResponse(this.baseURL, response);

    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json() as LoginResponse;

    if (!data.ok) {
      throw new Error(data.error || "UNAUTHORIZED");
    }

    // MoonTVPlus explicitly returns the auth cookie value as `token` because
    // React Native commonly hides the Set-Cookie response header.
    if (typeof data.token === "string" && data.token) {
      await this.persistAuthToken(data.token);
    }

    const hasCookies = await this.hasAuthCookies();
    if (!hasCookies && password !== undefined) {
      logger.warn("Login succeeded but MoonTVPlus did not provide a usable auth session");
      throw new Error("AUTH_SESSION_NOT_AVAILABLE");
    }

    return data;
  }

  async logout(): Promise<{ ok: boolean }> {
    try {
      const response = await this._fetch("/api/logout", {
        method: "POST",
      });
      await this.clearAuthCookies();
      return response.json();
    } catch (error) {
      await this.clearAuthCookies();
      throw error;
    }
  }

  async getServerConfig(): Promise<ServerConfig> {
    const response = await this._fetch("/api/server-config");
    return response.json();
  }

  async getFavorites(key?: string): Promise<Record<string, Favorite> | Favorite | null> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url);
    return response.json();
  }

  async addFavorite(key: string, favorite: Omit<Favorite, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, favorite }),
    });
    return response.json();
  }

  async deleteFavorite(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getPlayRecords(): Promise<Record<string, PlayRecord>> {
    const response = await this._fetch("/api/playrecords");
    return response.json();
  }

  async savePlayRecord(key: string, record: Omit<PlayRecord, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/playrecords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, record }),
    });
    return response.json();
  }

  async deletePlayRecord(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/playrecords?key=${encodeURIComponent(key)}` : "/api/playrecords";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getSearchHistory(): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory");
    return response.json();
  }

  async addSearchHistory(keyword: string): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword }),
    });
    return response.json();
  }

  async deleteSearchHistory(keyword?: string): Promise<{ success: boolean }> {
    const url = keyword ? `/api/searchhistory?keyword=${keyword}` : "/api/searchhistory";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  getImageProxyUrl(imageUrl: string): string {
    return `${this.baseURL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  }

  async getDoubanData(
    type: "movie" | "tv",
    tag: string,
    pageSize: number = 16,
    pageStart: number = 0
  ): Promise<DoubanResponse> {
    const url = `/api/douban?type=${type}&tag=${encodeURIComponent(tag)}&pageSize=${pageSize}&pageStart=${pageStart}`;
    const response = await this._fetch(url);
    return response.json();
  }

  async searchVideos(query: string): Promise<{ results: SearchResult[] }> {
    const url = `/api/search?q=${encodeURIComponent(query)}`;
    const response = await this._fetch(url);
    return response.json();
  }

  async searchVideo(query: string, resourceId: string, signal?: AbortSignal): Promise<{ results: SearchResult[] }> {
    const url = `/api/search/one?q=${encodeURIComponent(query)}&resourceId=${encodeURIComponent(resourceId)}`;
    const response = await this._fetch(url, { signal });
    const { results } = await response.json();
    return { results: results.filter((item: any) => item.title === query )};
  }

  async getResources(signal?: AbortSignal): Promise<ApiSite[]> {
    const url = `/api/search/resources`;
    const response = await this._fetch(url, { signal });
    return response.json();
  }

  async getVideoDetail(source: string, id: string): Promise<VideoDetail> {
    const url = `/api/detail?source=${source}&id=${id}`;
    const response = await this._fetch(url);
    return response.json();
  }
}

// 默认实例
export let api = new API();
