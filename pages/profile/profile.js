import { request, config } from '../../utils/request';
import { showToast } from '../../utils/ui';
import { copyToClipboard } from '../../utils/clipboard';

const PAGE_SIZE = 10;

// 昵称同步防抖（1.5s 内只触发一次）
let _nicknameTimer = null;

Page({
  data: {
    userInfo: { nickname: '', avatar: '' },
    openId: '',
    isLoggedIn: false,
    isLoggingIn: false,
    isAdmin: false,
    stats: null,
    // 解析记录
    allRecords: [],
    visibleRecords: [],
    page: 1,
    noMoreData: false,
    isLoadingRecords: false,
    recordsLoaded: false,
    // 记录预览面板
    previewVisible: false,
    previewRecord: {},
    previewFirstLiveUrl: '',
    // 搜索/筛选
    inputValue: '',
    searchQuery: '',
    period: 'all',
    periodIndex: 0,
    periodOptions: [
      { label: '全部',  value: 'all'       },
      { label: '今天',  value: 'today'     },
      { label: '3天',   value: '3days'     },
      { label: '7天',   value: '7days'     },
      { label: '30天',  value: '30days'    },
      { label: '60天',  value: '60days'    },
    ],
  },

  onLoad() {
    const openId   = wx.getStorageSync('openId');
    const userInfo = wx.getStorageSync('userInfo');
    const isAdmin  = wx.getStorageSync('isAdmin') || false;
    if (openId) {
      this.setData({
        openId,
        isLoggedIn: true,
        isAdmin,
        userInfo: this._normalizeUser(userInfo),
        openIdMask: openId.slice(0, 6) + '****' + openId.slice(-4),
      });
      this._syncProfileFromServer();
      this.fetchRecords();
      if (isAdmin) this._fetchStats();
    }
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 });
    }
    if (this.data.isLoggedIn && this.data.recordsLoaded) {
      this.fetchRecords();
    }
  },

  onReachBottom() {
    if (this.data.isLoggedIn && !this.data.noMoreData && !this.data.isLoadingRecords) {
      this._loadNextPage();
    }
  },

  // ─── 内部工具 ─────────────────────────────────────────────────────────────

  _normalizeUser(raw) {
    if (!raw) return { nickname: '', avatar: '' };
    return {
      nickname: raw.nickname || raw.nickName || '',
      avatar:   raw.avatar   || raw.avatarUrl || '',
    };
  },

  _saveUser(userInfo) {
    wx.setStorageSync('userInfo', userInfo);
    this.setData({ userInfo });
  },

  // ─── 登录 ─────────────────────────────────────────────────────────────────

  async doLogin() {
    if (this.data.isLoggingIn) return;
    this.setData({ isLoggingIn: true });
    try {
      const { code } = await new Promise((resolve, reject) =>
        wx.login({ success: resolve, fail: reject })
      );
      const res = await new Promise((resolve, reject) =>
        wx.request({
          url: `${config.baseURL}/api/login`,
          method: 'POST',
          data: { code },
          success: r => (r.statusCode >= 200 && r.statusCode < 300)
            ? resolve(r.data)
            : reject(new Error(r.data?.error || '登录失败')),
          fail: e => reject(new Error(e.errMsg || '网络错误')),
        })
      );
      const { openid, nickname, avatar_url, is_admin } = res || {};
      if (!openid) throw new Error('未获取到用户信息');

      const isAdmin = is_admin || false;
      const userInfo = { nickname: nickname || '', avatar: avatar_url || '' };
      wx.setStorageSync('openId', openid);
      wx.setStorageSync('isAdmin', isAdmin);
      this._saveUser(userInfo);
      this.setData({
        openId: openid,
        isLoggedIn: true,
        isAdmin,
        openIdMask: openid.slice(0, 6) + '****' + openid.slice(-4),
      });
      showToast('登录成功', 'success');
      this.fetchRecords();
      if (isAdmin) this._fetchStats();
    } catch (e) {
      showToast(e.message || '登录失败，请重试', 'none');
    } finally {
      this.setData({ isLoggingIn: false });
    }
  },

  // ─── 用户信息 ─────────────────────────────────────────────────────────────

  _syncProfileFromServer() {
    const { openId } = this.data;
    if (!openId) return;
    request('/api/get_userinfo', { method: 'GET', header: { 'WX-OPEN-ID': openId } })
      .then(res => {
        const d = res?.data || res;
        if (!d?.nickname && !d?.avatar_url) return;
        const userInfo = {
          nickname: d.nickname   || this.data.userInfo.nickname,
          avatar:   d.avatar_url || this.data.userInfo.avatar,
        };
        this._saveUser(userInfo);
      })
      .catch(e => console.error('[profile] syncProfile:', e));
  },

  _uploadUserInfo(userInfo) {
    const { openId } = this.data;
    if (!openId) return;
    request('/api/upload_userinfo', {
      method: 'POST',
      header: { 'WX-OPEN-ID': openId },
      data: { nickname: userInfo.nickname, avatar_url: userInfo.avatar },
    }).catch(e => console.error('[profile] uploadUserInfo:', e));
  },

  onChooseAvatar(e) {
    const filePath = e.detail?.avatarUrl;
    if (!filePath) return;
    showToast('正在上传...', 'loading');
    wx.uploadFile({
      url: `${config.baseURL}/api/upload_avatar`,
      filePath,
      name: 'file',
      header: { 'WX-OPEN-ID': this.data.openId },
      success: res => {
        try {
          const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          if (data?.success) {
            const userInfo = { ...this.data.userInfo, avatar: data.url };
            this._saveUser(userInfo);
            this._uploadUserInfo(userInfo);
            showToast('头像已更新', 'success');
          } else {
            showToast('上传失败: ' + (data?.message || '未知错误'), 'none');
          }
        } catch (err) {
          showToast('上传失败', 'none');
        }
      },
      fail: () => showToast('网络错误，上传失败', 'none'),
    });
  },

  onNicknameInput(e) {
    const nickname = e.detail.value;
    const userInfo = { ...this.data.userInfo, nickname };
    this._saveUser(userInfo);
    clearTimeout(_nicknameTimer);
    _nicknameTimer = setTimeout(() => this._uploadUserInfo(userInfo), 1500);
  },

  // ─── 退出 ─────────────────────────────────────────────────────────────────

  doLogout() {
    wx.showModal({
      title: '确认退出',
      content: '退出后需重新登录才能查看解析记录',
      success: ({ confirm }) => {
        if (!confirm) return;
        wx.removeStorageSync('openId');
        wx.removeStorageSync('userInfo');
        wx.removeStorageSync('isAdmin');
        clearTimeout(_nicknameTimer);
        this.setData({
          isLoggedIn: false, openId: '', openIdMask: '',
          isAdmin: false, stats: null,
          userInfo: { nickname: '', avatar: '' },
          allRecords: [], visibleRecords: [],
          page: 1, noMoreData: false, recordsLoaded: false,
        });
      },
    });
  },

  // ─── 管理员统计 ───────────────────────────────────────────────────────────

  _fetchStats() {
    const { openId } = this.data;
    if (!openId) return;
    request('/api/stats', {
      method: 'GET',
      header: { 'WX-OPEN-ID': openId },
    }).then(res => {
      if (res?.data) this.setData({ stats: res.data });
    }).catch(e => console.error('[profile] fetchStats:', e));
  },

  // ─── 解析记录 ─────────────────────────────────────────────────────────────

  async fetchRecords() {
    if (this.data.isLoadingRecords) return;
    const { openId, searchQuery, period } = this.data;
    if (!openId) return;
    this.setData({ isLoadingRecords: true });
    try {
      const res = await request('/api/records', {
        method: 'POST',
        header: { 'WX-OPEN-ID': openId },
        data: { searchQuery, period },
      });
      const list = Array.isArray(res?.ranking?.list) ? res.ranking.list : [];
      const allRecords = list.map(r => ({ ...r, created_at: this._formatTime(r.save_time) }));

      this.setData({ allRecords, visibleRecords: [], page: 1, noMoreData: false, recordsLoaded: true });
      this._loadNextPage();
    } catch (e) {
      console.error('[profile] fetchRecords:', e);
      showToast('记录加载失败', 'none');
    } finally {
      this.setData({ isLoadingRecords: false });
    }
  },

  _loadNextPage() {
    const { allRecords, visibleRecords, page, noMoreData } = this.data;
    if (noMoreData) return;
    const slice = allRecords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    if (!slice.length) {
      this.setData({ noMoreData: true });
      return;
    }
    this.setData({
      visibleRecords: visibleRecords.concat(slice),
      page: page + 1,
      noMoreData: slice.length < PAGE_SIZE,
    });
  },

  // ─── 搜索 / 筛选 ──────────────────────────────────────────────────────────

  onSearchInput(e) { this.setData({ inputValue: e.detail.value }); },

  onSearchConfirm() {
    this.setData({ searchQuery: this.data.inputValue });
    this.fetchRecords();
  },

  onClearSearch() {
    this.setData({ inputValue: '', searchQuery: '' });
    this.fetchRecords();
  },

  onPeriodTab(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index === this.data.periodIndex) return;
    this.setData({ periodIndex: index, period: this.data.periodOptions[index].value });
    this.fetchRecords();
  },

  onPeriodChange(e) {
    const index = Number(e.detail.value);
    this.setData({ periodIndex: index, period: this.data.periodOptions[index].value });
    this.fetchRecords();
  },

  // ─── 点击记录 ─────────────────────────────────────────────────────────────

  onRecordTap(e) {
    const record = e.currentTarget.dataset.record;
    if (!record) return;
    const liveUrls = Array.isArray(record.live_photo_urls) ? record.live_photo_urls : [];
    const previewFirstLiveUrl = liveUrls.find(u => u) || '';
    this.setData({ previewRecord: record, previewFirstLiveUrl, previewVisible: true });
    this._ensurePlayableUrl(record);
  },

  async _ensurePlayableUrl(record) {
    const { video_url, video_id } = record;
    if (!video_url || video_url.indexOf('douyinvod.com') === -1) return;
    try {
      const res = await request('/api/download', {
        method: 'POST',
        data: { media_type: 'video', video_url, video_id, force_cache: true },
      });
      const proxyUrl = res?.retcode === 200 && res?.data?.download_url
        ? res.data.download_url : null;
      if (proxyUrl && this.data.previewVisible) {
        this.setData({ 'previewRecord.video_url': proxyUrl });
      }
    } catch (e) {
      console.error('[profile] ensurePlayableUrl:', e);
    }
  },

  closePreview() {
    // 停止内嵌视频播放
    try { wx.createVideoContext('previewVideo', this).stop(); } catch (e) {}
    this.setData({ previewVisible: false });
  },

  openPreviewMedia() {
    const { video_url, cover_url, title, video_id, images, live_photo_urls, material_type } = this.data.previewRecord;
    this.closePreview();

    // 动图/图文：优先用 previewMedia/previewImage，不走视频播放器
    if (material_type === '动图' || material_type === '图文') {
      const liveUrls = Array.isArray(live_photo_urls) ? live_photo_urls : [];
      const imgList = Array.isArray(images) && images.length > 0 ? images : (cover_url ? [cover_url] : []);

      if (liveUrls.some(u => u)) {
        // 有动图流：previewMedia 混合播放
        const sources = imgList.map((imgUrl, i) => {
          const lv = liveUrls[i] || '';
          return lv ? { url: lv, type: 'video', poster: imgUrl } : { url: imgUrl, type: 'image' };
        });
        wx.previewMedia({ sources, current: 0 });
      } else if (video_url && material_type === '动图') {
        // 动图但无 live_photo_urls（从记录加载），用 video_url 作为动图流
        const sources = imgList.length > 0
          ? imgList.map((imgUrl, i) => i === 0 ? { url: video_url, type: 'video', poster: imgUrl } : { url: imgUrl, type: 'image' })
          : [{ url: video_url, type: 'video' }];
        wx.previewMedia({ sources, current: 0 });
      } else if (imgList.length > 0) {
        wx.previewImage({ urls: imgList, current: imgList[0] });
      }
      return;
    }

    // 视频：跳转播放器
    if (video_url) {
      wx.navigateTo({
        url: `/pages/videoPlayer/videoPlayer?url=${encodeURIComponent(video_url)}&cover=${encodeURIComponent(cover_url || '')}&title=${encodeURIComponent(title || '')}&videoid=${encodeURIComponent(video_id || '')}`,
      });
      return;
    }

    // 兜底：封面图预览
    if (cover_url) {
      wx.previewImage({ urls: [cover_url], current: cover_url });
    }
  },

  copyVideoUrl() {
    const { video_url } = this.data.previewRecord;
    if (!video_url) return;
    copyToClipboard(video_url, { title: '视频链接已复制' }).catch(() => {});
  },

  copyCoverUrl() {
    const { cover_url } = this.data.previewRecord;
    if (!cover_url) return;
    copyToClipboard(cover_url, { title: '封面链接已复制' }).catch(() => {});
  },

  // ─── 管理员工具 ───────────────────────────────────────────────────────────

  goApiConfig() {
    wx.navigateTo({ url: '/pages/apiConfig/apiConfig' });
  },

  // ─── 工具 ─────────────────────────────────────────────────────────────────

  onAvatarError(e) {
    // 头像加载失败（过期签名 URL 等），清空对应记录的 author_avatar 降级为占位符
    const dataset = e.currentTarget.dataset;
    const videoId = dataset && dataset.videoid;
    if (!videoId) return;
    const records = this.data.visibleRecords.map(r =>
      r.video_id === videoId ? { ...r, author_avatar: '' } : r
    );
    this.setData({ visibleRecords: records });
  },

  _formatTime(dateStr) {
    if (!dateStr) return '';
    const normalized = dateStr.replace(' ', 'T');
    const d = new Date(normalized);
    if (isNaN(d)) return dateStr;
    const diff = Date.now() - d;
    if (diff < 60000)     return '刚刚';
    if (diff < 3600000)   return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000)  return `${Math.floor(diff / 3600000)}小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  },
});
