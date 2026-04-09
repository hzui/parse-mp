import { config } from '../../utils/request';

const CACHE_KEY = 'moyu_cache';

Page({
  data: {
    imgUrl: '',
    isLoading: false,
    loadError: false,
    cacheHit: false,    // 本次是否命中缓存
  },

  onLoad() {
    this._loadWithCache(false);
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
  },

  // ─── 缓存读写 ─────────────────────────────────────────────────────────────

  _today() {
    return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  },

  _readCache() {
    try {
      const raw = wx.getStorageSync(CACHE_KEY);
      if (!raw) return null;
      const cache = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (cache && cache.date === this._today() && cache.url) return cache;
    } catch (e) {}
    return null;
  },

  _writeCache(url) {
    try {
      wx.setStorageSync(CACHE_KEY, JSON.stringify({ date: this._today(), url }));
    } catch (e) {}
  },

  // ─── 主加载逻辑 ───────────────────────────────────────────────────────────

  _loadWithCache(forceRefresh) {
    if (!forceRefresh) {
      const cache = this._readCache();
      if (cache) {
        // 命中今日缓存，直接展示，isLoading 保持 false（图片已缓存，不需要转圈）
        this.setData({ imgUrl: cache.url, isLoading: false, loadError: false, cacheHit: true });
        return;
      }
    }
    // 未命中或强制刷新 → 拉取远端
    this._fetchRemote(forceRefresh);
  },

  _fetchRemote(forceRefresh) {
    this.setData({ isLoading: true, loadError: false, cacheHit: false });
    wx.request({
      url: `${config.baseURL}/admin/api/app_config`,
      method: 'GET',
      success: res => {
        const rows = Array.isArray(res.data?.data) ? res.data.data : [];
        const data = {};
        rows.forEach(r => { data[r.config_key] = r.config_value; });
        const enabled = data.moyu_enabled !== '0';
        const apiUrl = data.moyu_api_url || 'https://api.52vmy.cn/api/wl/moyu';
        if (!enabled) {
          this.setData({ isLoading: false, loadError: true });
          return;
        }
        // 强制刷新时加时间戳让微信图片组件重新请求，否则用日期参数复用微信图片缓存
        const url = forceRefresh
          ? `${apiUrl}?d=${this._today()}&t=${Date.now()}`
          : `${apiUrl}?d=${this._today()}`;
        this._writeCache(`${apiUrl}?d=${this._today()}`); // 缓存始终存日期版 URL
        this.setData({ imgUrl: url });
      },
      fail: () => {
        const baseUrl = 'https://api.52vmy.cn/api/wl/moyu';
        const url = forceRefresh
          ? `${baseUrl}?d=${this._today()}&t=${Date.now()}`
          : `${baseUrl}?d=${this._today()}`;
        this._writeCache(`${baseUrl}?d=${this._today()}`);
        this.setData({ imgUrl: url });
      },
    });
  },

  // ─── 事件处理 ─────────────────────────────────────────────────────────────

  onImgLoad() {
    this.setData({ isLoading: false });
  },

  onImgError() {
    // 图片加载失败时清除缓存，下次进入会重新拉取
    try { wx.removeStorageSync(CACHE_KEY); } catch (e) {}
    this.setData({ isLoading: false, loadError: true, imgUrl: '', cacheHit: false });
  },

  onRefresh() {
    if (this.data.isLoading) return;
    this._loadWithCache(true); // 强制刷新，跳过缓存
  },

  // 转发给朋友
  onShareAppMessage() {
    return {
      title: '摸鱼日报更新了，快来看看吧！',
      path: '/pages/moyu/moyu',
      imageUrl: this.data.imgUrl || '',
    };
  },

  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '摸鱼日报 | 今天也要快乐打工 🐟',
    };
  },
});

