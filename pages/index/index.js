import { request } from '../../utils/request';
import { getClipboardData, copyToClipboard } from '../../utils/clipboard';
import { truncateString } from '../../utils/util';
import { downloadCoverToPhotosAlbum, downloadVideoToPhotosAlbum, downloadImagesToPhotosAlbum, downloadMixedAlbum } from '../../utils/file';
import { showToast, showConfirmModal } from '../../utils/ui';

Page({
  data: {
    inputValue: '',
    showVideo: false,
    showArticle: false,
    showCoverButton: false,
    showSaveCoverButton: false,
    showSaveVideoButton: false,
    showSaveAlbumButton: false,
    // 广告相关
    adEnabled: false,
    adUnitId: '',
    adUnlocked: false,  // 今日是否已解锁
    // 跳转结果页开关
    autoJumpResult: false,
    // 公告相关
    announcementEnabled: false,
    announcementContent: '',
    // 免责声明相关
    disclaimerEnabled: true,
    disclaimerContent: '',
    parseResults: [],
    selectedResultIndex: 0,
    savingVideo: false,
    downloadProgress: 0,
    isButtonDisabled: false,
    isLoading: false,
    showWhiteBackground: false,
    response: {
      video_url: '',
      video_source_url: '',
      share_url: '',
      title: '',
      cover_url: '',
      video_id: '',
      images: [],
      live_video_urls: [],
      music_url: '',
      music_play_url: ''
    },
    isClearMode: false,
    totalCount: 0, // 累计解析数据
    hasRetried: false, // 标记当前展示的视频是否已尝试重试
    audioPlaying: false,
    audioLoading: false,
    showCopyPanel: false,
    copyPanelText: '',
    gifCurrentIndex: 0,     // 动图 swiper 当前帧索引
    gifVideoDuration: 0,    // 当前帧视频总时长(秒)
    gifVideoProgress: 0,    // 当前帧播放进度 0~1
    gifCurrentTimeStr: '0:00',
    gifDurationStr: '0:00',
  },

  onLoad: function() {
    this._loadAdStatus();
    this._loadAnnouncement();
    this._loadJumpConfig();
  },

  onShow: function() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
    const app = getApp();
    if (app.globalData.reparseUrl) {
      const url = app.globalData.reparseUrl;
      app.globalData.reparseUrl = '';
      this.setData({ inputValue: url });
      this.onSubmit();
    }
  },

  onHide: function() {
  },

  onUnload: function() {
  },

  onInput: function(e) {
    this.setData({
      inputValue: e.detail.value
    });
  },

  doPaste: async function() {
    try {
      const data = await getClipboardData();
      this.setData({
        inputValue: data,
        isClearMode: true
      });
      showToast('已粘贴', 'success', 1500);
    } catch (error) {
      showToast('剪贴板无内容', 'none', 1500);
    }
  },
  
  // ── 公告相关 ──────────────────────────────────────────────────────────────

  /** 拉取首页公告 + 免责声明配置 */
  async _loadAnnouncement() {
    try {
      const res = await request('/api/announcement', { method: 'GET' });
      const d = res.data || {};
      this.setData({
        announcementEnabled: !!d.enabled,
        announcementContent: d.content || '',
        disclaimerEnabled: d.disclaimer_enabled !== false,
        disclaimerContent: d.disclaimer_content || '',
      });
    } catch (e) {
      this.setData({ announcementEnabled: false, disclaimerEnabled: true });
    }
  },

  /** 拉取跳转结果页开关 */
  async _loadJumpConfig() {
    try {
      const res = await request('/admin/api/app_config', { method: 'GET' });
      const rows = Array.isArray(res?.data) ? res.data : [];
      const cfg = {};
      rows.forEach(row => { cfg[row.config_key] = row.config_value; });
      this.setData({ autoJumpResult: cfg.auto_jump_result === '1' });
    } catch (e) {
      // 接口失败时默认不跳转
    }
  },

  // ── 广告相关 ──────────────────────────────────────────────────────────────

  /** 拉取广告状态（开关 + 今日是否已解锁） */
  async _loadAdStatus() {
    try {
      const res = await request('/api/ad/status', { method: 'GET' });
      const d = res.data || {};
      this.setData({
        adEnabled: !!d.ad_enabled,
        adUnitId: d.ad_unit_id || '',
        adUnlocked: !!d.unlocked,
      });
      // 预加载广告对象，减少首次展示延迟
      if (d.ad_enabled && d.ad_unit_id) {
        this._initRewardedAd(d.ad_unit_id);
      }
    } catch (e) {
      // 降级：接口失败时不拦截解析
      this.setData({ adEnabled: false, adUnlocked: true });
    }
  },

  /** 初始化激励视频广告对象（仅创建一次） */
  _initRewardedAd(adUnitId) {
    if (this._rewardedAd) return;
    if (!wx.createRewardedVideoAd) return;
    this._rewardedAd = wx.createRewardedVideoAd({ adUnitId });
    this._rewardedAd.onError(err => {
      console.warn('激励广告加载失败', err);
    });
  },

  /** 展示激励广告弹窗引导，用户选择"去观看"后播放广告 */
  _showAdPrompt(onUnlocked) {
    wx.showModal({
      title: '温馨提示',
      content: '每日观看一次广告，即可解锁今日无限次免费解析！',
      confirmText: '去观看',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        this._playRewardedAd(onUnlocked);
      },
    });
  },

  /** 播放激励视频广告，完成后上报解锁 */
  _playRewardedAd(onUnlocked) {
    const ad = this._rewardedAd;
    if (!ad) {
      showToast('广告加载中，请稍后再试', 'none', 2000);
      return;
    }
    // 注册本次观看完成回调（每次播放前重新绑定，避免重复触发）
    const onClose = (res) => {
      ad.offClose(onClose);
      if (res && res.isEnded) {
        // 上报解锁
        request('/api/ad/unlock', { method: 'POST' })
          .then(() => {
            this.setData({ adUnlocked: true });
            showToast('解锁成功，今日免费解析不限次！', 'success', 2000);
            if (onUnlocked) onUnlocked();
          })
          .catch(() => {
            // 上报失败时本地标记解锁，不影响用户体验
            this.setData({ adUnlocked: true });
            if (onUnlocked) onUnlocked();
          });
      } else {
        showToast('需要看完广告才能解锁哦', 'none', 2000);
      }
    };
    ad.onClose(onClose);
    ad.show().catch(() => {
      ad.offClose(onClose);
      // 广告展示失败时重新加载并提示
      ad.load().catch(() => {});
      showToast('广告加载失败，请稍后再试', 'none', 2000);
    });
  },

  async onSubmit() {
    if (this.data.isButtonDisabled) return;

    // 广告解锁检查：开关开启且今日未解锁时，弹窗引导看广告
    if (this.data.adEnabled && !this.data.adUnlocked) {
      this._showAdPrompt(() => this.onSubmit());
      return;
    }

    this.setData({
      showVideo: false,
      showArticle: false,
      showCoverButton: false,
      showSaveCoverButton: false,
      showSaveVideoButton: false,
      savingVideo: false,
      downloadProgress: 0,
      isButtonDisabled: true,
      isLoading: true,
      showWhiteBackground: false,
      hasRetried: false, // 每次新解析都重置重试状态
      parseResults: [],
      selectedResultIndex: 0,
      response: {
        video_url: '',
        video_source_url: '',
        share_url: '',
        title: '',
        cover_url: '',
        video_id: '',
        images: [],
        music_url: '',
        music_play_url: ''
      }
    });
    if (this.innerAudioContext) {
      try { this.innerAudioContext.stop(); } catch (e) {}
    }
    this.setData({ audioPlaying: false, audioLoading: false });
    const { inputValue } = this.data;
    if (inputValue === '') {
      showToast('请输入或者粘贴分享链接', 'none', 2000);
      this.setData({
        isButtonDisabled: false,
        isLoading: false
      });
      return;
    }
    try {
      const response = await request('/api/parse', {
        method: 'POST',
        data: {
          text: inputValue
        }
      });
      if (response.retcode !== 200) {
        showToast(response.retdesc || '解析失败', 'none', 2000);
      } else {
        const data = response.data;
        const items = data && Array.isArray(data.items) ? data.items : null;
        const current = items && items.length > 0 ? items[0] : data;

        // 检查是否为降级模式（TikTok/Twitter 等需要 VPN 的平台）
        if (current && current.fallback_mode) {
          showConfirmModal(
            '提示',
            current.fallback_message || '解析服务暂时不可用，是否跳转到原链接？（需要 VPN）',
            () => {
              // 确认：复制链接到剪贴板并提示
              copyToClipboard(current.video_url);
              showToast('链接已复制，请在浏览器中打开', 'success', 2000);
            },
            () => {
              // 取消：不做任何操作
            }
          );
          this.setData({
            isButtonDisabled: false,
            isLoading: false
          });
          return;
        }

        if (!current || (!current.video_url && !current.title && !current.cover_url)) {
          showToast('无法获取到该视频信息，请稍后再试', 'none', 2000);
        } else {
          const mt = current.material_type || '';
          const isVideo = mt === '视频' || (!mt && !!current.video_url && mt !== '图文');
          const isDongtu = mt === '动图';
          const imageCount = Array.isArray(current.images) ? current.images.length : 0;
          const isAlbum = (isDongtu || !isVideo) && imageCount > 0;
          const sourceVideoUrl = current.video_url || '';
          const normalizeOne = (it) => {
            // 兼容不同后端字段命名：music_url / audio_url / music / musicUrl / audioUrl
            const musicUrl =
              it.music_url ||
              it.audio_url ||
              it.music ||
              it.musicUrl ||
              it.audioUrl ||
              '';
            return {
              ...it,
              // 兼容后端字段：audio_url (starter) / music_url (其他实现)
              music_url: musicUrl,
              video_source_url: it.video_source_url || it.video_url || '',
              // 动图：确保 live_video_urls 列表存在
              live_video_urls: Array.isArray(it.live_video_urls) ? it.live_video_urls : []
            };
          };
          const normalizedItems = (items || []).map(normalizeOne);
          const normalizedCurrent = normalizeOne(current);
          if (!(normalizedCurrent.music_url || normalizedCurrent.audio_url)) {
            console.log('解析结果未包含音频字段，raw current =', current);
          }
          const jumping = this.data.autoJumpResult;
          this.setData({
            response: { ...normalizedCurrent, video_source_url: normalizedCurrent.video_source_url || sourceVideoUrl },
            parseResults: normalizedItems,
            selectedResultIndex: 0,
            showVideo: isVideo || isDongtu,
            showArticle: !!current.title,
            showCoverButton: !!current.cover_url,
            showSaveVideoButton: isVideo,
            showSaveCoverButton: !!current.cover_url,
            showSaveAlbumButton: isAlbum,
            // 跳转模式下不在 index 渲染结果区，避免 <video> 用原始 CDN URL 触发 403
            showWhiteBackground: !jumping,
            gifCurrentIndex: 0
          });
          this.ensurePlayableGifUrls();
          this.ensurePlayableMusicUrl();

          if (jumping) {
            // 解析完成立即跳转，result 页自行处理所有代理和展示
            const app = getApp();
            app.globalData.parseResult = {
              response: this.data.response,
              parseResults: this.data.parseResults,
              selectedResultIndex: this.data.selectedResultIndex,
              showVideo: this.data.showVideo,
              showArticle: this.data.showArticle,
              showCoverButton: this.data.showCoverButton,
              showSaveCoverButton: this.data.showSaveCoverButton,
              showSaveVideoButton: this.data.showSaveVideoButton,
              showSaveAlbumButton: this.data.showSaveAlbumButton,
            };
            wx.navigateTo({ url: '/pages/result/result' });
          } else {
            this.ensurePlayableVideoUrl();
          }
        }
      }
    } catch (error) {
      console.error('请求失败:', error);
      showToast(error.message || '网络请求失败，请检查网络或稍后重试', 'none', 2000);
    } finally {
      setTimeout(() => {
        this.setData({
          isButtonDisabled: false,
          isLoading: false
        });
      }, 1000);
    }
  },

  selectResult(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const item = (this.data.parseResults || [])[index];
    if (!item) return;
    if (this.innerAudioContext) {
      try { this.innerAudioContext.stop(); } catch (e) {}
    }
    this.setData({ audioPlaying: false, audioLoading: false });
    const mt = item.material_type || '';
    const isVideo = mt === '视频' || (!mt && !!item.video_url && mt !== '图文');
    const isDongtu = mt === '动图';
    const imageCount = Array.isArray(item.images) ? item.images.length : 0;
    const isAlbum = (isDongtu || !isVideo) && imageCount > 0;
    const sourceVideoUrl = item.video_url || '';
    this.setData({
      selectedResultIndex: index,
      response: { ...item, video_source_url: item.video_source_url || sourceVideoUrl },
      showVideo: isVideo || isDongtu,
      showArticle: !!item.title,
      showCoverButton: !!item.cover_url,
      showSaveVideoButton: isVideo,
      showSaveCoverButton: !!item.cover_url,
      showSaveAlbumButton: isAlbum,
      showWhiteBackground: true,
      gifCurrentIndex: 0
    });
    this.ensurePlayableVideoUrl();
    this.ensurePlayableGifUrls();
    this.ensurePlayableMusicUrl();
  },

  async ensurePlayableGifUrls() {
    const { live_video_urls, video_id, material_type } = this.data.response || {};
    if (material_type !== '动图') return;
    if (!Array.isArray(live_video_urls) || live_video_urls.length === 0) return;

    // 需要代理的抖音域名（不在小程序白名单内）
    const needsProxy = u => this._needsVideoProxy(u);
    if (!live_video_urls.some(needsProxy)) return;

    try {
      const tasks = live_video_urls.map((url, idx) => {
        // 空串（无 live 的静态帧）直接保留
        if (!url) return Promise.resolve({ idx, url: '' });
        if (!needsProxy(url)) return Promise.resolve({ idx, url });
        return request('/api/download', {
          method: 'POST',
          data: {
            media_type: 'video',
            video_url: url,
            video_id: `${video_id}_gif${idx}`,
            force_cache: true
          }
        }).then(res => {
          const proxyUrl = res && res.retcode === 200 && res.data && res.data.download_url
            ? res.data.download_url : url;
          return { idx, url: proxyUrl };
        }).catch(() => ({ idx, url }));
      });

      const results = await Promise.all(tasks);
      const resolvedUrls = live_video_urls.slice();
      results.forEach(({ idx, url }) => { resolvedUrls[idx] = url; });

      this.setData({ 'response.live_video_urls': resolvedUrls });

      // 同步更新 parseResults 缓存
      const parseResults = this.data.parseResults;
      if (Array.isArray(parseResults) && parseResults.length > 0) {
        const selIdx = this.data.selectedResultIndex || 0;
        const updated = parseResults.slice();
        if (updated[selIdx]) {
          updated[selIdx] = { ...updated[selIdx], live_video_urls: resolvedUrls };
          this.setData({ parseResults: updated });
        }
      }
    } catch (e) {
      console.error('ensurePlayableGifUrls error:', e);
    }
  },

  _needsVideoProxy(url) {
    if (!url) return false;
    return (
      url.indexOf('douyinvod.com') !== -1 ||
      url.indexOf('douyinstatic.com') !== -1 ||
      url.indexOf('tos-cn-ve') !== -1 ||
      url.indexOf('xhscdn.com') !== -1 ||
      url.indexOf('sns-video') !== -1
    );
  },

  async ensurePlayableVideoUrl() {
    const { video_url, video_id } = this.data.response || {};
    if (!video_url) return;
    if (!this._needsVideoProxy(video_url)) return;
    try {
      const res = await request('/api/download', {
        method: 'POST',
        data: {
          media_type: 'video',
          video_url,
          video_id,
          force_cache: true
        }
      });
      if (res && res.retcode === 200 && res.data && res.data.download_url) {
        const url = res.data.download_url;
        this.setData({
          'response.video_url': url
        });
        if (Array.isArray(this.data.parseResults) && this.data.parseResults.length > 0) {
          const idx = this.data.selectedResultIndex || 0;
          const updated = this.data.parseResults.slice();
          if (updated[idx]) {
            updated[idx] = { ...updated[idx], video_url: url };
            this.setData({ parseResults: updated });
          }
        }
      }
    } catch (e) {
    }
  },

  async ensurePlayableMusicUrl() {
    const { music_url, audio_url, video_id } = this.data.response || {};
    const sourceMusicUrl = music_url || audio_url;
    if (!sourceMusicUrl) return;
    this.setData({ audioLoading: true });
    try {
      const res = await request('/api/download', {
        method: 'POST',
        data: {
          media_type: 'audio',
          // 兼容后端字段：audio_url / music_url
          audio_url: sourceMusicUrl,
          audio_id: video_id,
          force_cache: true
        }
      });
      if (res && res.retcode === 200 && res.data && res.data.download_url) {
        const url = res.data.download_url;
        this.setData({
          'response.music_play_url': url
        });
        if (Array.isArray(this.data.parseResults) && this.data.parseResults.length > 0) {
          const idx = this.data.selectedResultIndex || 0;
          const updated = this.data.parseResults.slice();
          if (updated[idx]) {
            updated[idx] = { ...updated[idx], music_play_url: url };
            this.setData({ parseResults: updated });
          }
        }
      }
    } catch (e) {
    } finally {
      this.setData({ audioLoading: false });
    }
  },

  toggleAudio() {
    if (this.data.audioLoading) {
      showToast('音频准备中，请稍候…', 'none', 1500);
      return;
    }
    const { music_url, audio_url, music_play_url } = this.data.response || {};
    const playUrl = music_play_url || music_url || audio_url;
    if (!playUrl) return;
    if (!this.innerAudioContext) {
      this.innerAudioContext = wx.createInnerAudioContext();
      this.innerAudioContext.onEnded(() => {
        this.setData({ audioPlaying: false });
      });
      this.innerAudioContext.onStop(() => {
        this.setData({ audioPlaying: false });
      });
      this.innerAudioContext.onError(() => {
        this.setData({ audioPlaying: false });
      });
    }
    if (this.data.audioPlaying) {
      this.innerAudioContext.pause();
      this.setData({ audioPlaying: false });
    } else {
      if (this.innerAudioContext.src !== playUrl) {
        this.innerAudioContext.src = playUrl;
      }
      this.innerAudioContext.play();
      this.setData({ audioPlaying: true });
    }
  },

  copyMusicUrl() {
    const { music_url, audio_url } = this.data.response || {};
    const url = music_url || audio_url;
    if (!url) return;
    copyToClipboard(url, { title: '音乐链接已复制' }).catch(() => {
      this.openCopyPanel(url || '');
    });
  },

  onGifSwiperChange(e) {
    const newIndex = e.detail.current;
    const old = this.data.gifCurrentIndex;
    this.setData({
      gifCurrentIndex: newIndex,
      gifVideoDuration: 0,
      gifVideoProgress: 0,
      gifCurrentTimeStr: '0:00',
      gifDurationStr: '0:00',
    });
    const { live_video_urls } = this.data.response || {};
    // 暂停旧帧
    if (Array.isArray(live_video_urls) && live_video_urls[old]) {
      const oldCtx = wx.createVideoContext(`gifVideo${old}`, this);
      if (oldCtx) oldCtx.pause();
    }
    // 主动播放新帧（autoplay 属性变化不触发重播）
    if (Array.isArray(live_video_urls) && live_video_urls[newIndex]) {
      const newCtx = wx.createVideoContext(`gifVideo${newIndex}`, this);
      if (newCtx) newCtx.play();
    }
  },

  // Swiper 箭头控制：上一帧
  onSwiperPrev() {
    const { gifCurrentIndex } = this.data;
    if (gifCurrentIndex > 0) {
      this.setData({ gifCurrentIndex: gifCurrentIndex - 1 });
    }
  },

  // Swiper 箭头控制：下一帧
  onSwiperNext() {
    const { gifCurrentIndex, response } = this.data;
    if (response.images && gifCurrentIndex < response.images.length - 1) {
      this.setData({ gifCurrentIndex: gifCurrentIndex + 1 });
    }
  },

  onGifTimeUpdate(e) {
    // 仅处理当前展示帧的 timeupdate
    const index = Number(e.currentTarget.dataset.index || 0);
    if (index !== this.data.gifCurrentIndex) return;
    const { currentTime, duration } = e.detail;
    if (!duration || duration <= 0) return;
    const progress = currentTime / duration;
    this.setData({
      gifVideoDuration: duration,
      gifVideoProgress: progress,
      gifCurrentTimeStr: this._fmtTime(currentTime),
      gifDurationStr: this._fmtTime(duration),
    });
  },

  _fmtTime(sec) {
    const s = Math.floor(sec || 0);
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${m}:${ss < 10 ? '0' : ''}${ss}`;
  },

  onGifVideoTap(e) {
    // 点击有 live video 的帧 → previewMedia 全屏播放，混合帧有 live 用 video 类型，无 live 用 image 类型
    const index = Number(e.currentTarget.dataset.index || 0);
    const { live_video_urls, images } = this.data.response;
    if (!Array.isArray(images) || !images.length) return;
    const sources = images.map((imgUrl, i) => {
      const lv = Array.isArray(live_video_urls) ? (live_video_urls[i] || '') : '';
      return lv
        ? { url: lv, type: 'video', poster: imgUrl }
        : { url: imgUrl, type: 'image' };
    });
    wx.previewMedia({ sources, current: index });
  },

  onGifImageTap(e) {
    // 点击无 live video 的静态帧 → 同样用 previewMedia 统一全屏预览（保持帧序一致）
    this.onGifVideoTap(e);
  },

  viewImageAtIndex(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const { cover_url, images, live_photo_urls } = this.data.response;
    const urls = Array.isArray(images) && images.length > 0 ? images : [cover_url];
    const liveUrl = Array.isArray(live_photo_urls) ? (live_photo_urls[index] || '') : '';

    if (liveUrl) {
      // 动图：用 previewMedia 播放视频流
      const sources = urls.map((imgUrl, i) => {
        const lv = Array.isArray(live_photo_urls) ? (live_photo_urls[i] || '') : '';
        return lv
          ? { url: lv, type: 'video', poster: imgUrl }
          : { url: imgUrl, type: 'image' };
      });
      wx.previewMedia({ sources, current: index });
    } else {
      // 普通图文：previewImage 滑动查看
      wx.previewImage({ urls, current: urls[index] || urls[0] });
    }
  },

  viewCoverImage() {
    const { cover_url, images } = this.data.response;
    const urls = Array.isArray(images) && images.length > 0 ? images : [cover_url];
    wx.previewImage({
      urls,
      current: urls[0]
    });
  },

  clearInput() {
    this.setData({
      inputValue: '',
      isClearMode: false
    });
  },

  async downloadVideo() {
    const { video_url, video_id } = this.data.response;
    try {
      const message = await downloadVideoToPhotosAlbum(video_url, video_id);
      showToast(message, 'success');
    } catch (error) {
      if (error && error.type === 'auth') {
        // 用户取消授权或权限被拒，静默处理，不复制链接
      } else {
        copyToClipboard(video_url);
        showToast('下载失败: 视频地址已复制，您可以尝试手动下载', 'none');
      }
    }
  },

  async downloadCover() {
    try {
      const { cover_url } = this.data.response;
      downloadCoverToPhotosAlbum(cover_url, true, (error) => {
        if (error) {
          const msg = (error.errMsg || '').toLowerCase();
          if (msg.includes('cancel') || msg.includes('deny') || msg.includes('authorize') || msg.includes('permission')) {
            // 用户取消授权或权限被拒，静默处理
          } else {
            copyToClipboard(cover_url, { title: '下载失败: 封面地址已复制，您可以尝试手动下载', icon: 'none' });
          }
        }
      });
    } catch (error) {
      showToast('出错，请重试', 'none', 2000);
    }
  },

  async downloadAlbum() {
    const { images, live_video_urls, material_type, video_id } = this.data.response;
    if (!Array.isArray(images) || images.length === 0) {
      showToast('无可保存的图集', 'none');
      return;
    }
    try {
      if (material_type === '动图' && Array.isArray(live_video_urls) && live_video_urls.some(u => u)) {
        // 动图/混合：按帧判断，有 live video 保存为视频，无则保存为图片
        const frames = images.map((imgUrl, i) => ({
          imageUrl: imgUrl,
          videoUrl: (live_video_urls[i] || '')
        }));
        const message = await downloadMixedAlbum(frames, video_id);
        showToast(message, 'success');
      } else {
        // 纯图文：全部保存为图片
        const message = await downloadImagesToPhotosAlbum(images);
        showToast(message, 'success');
      }
    } catch (error) {
      if (error && error.url) {
        copyToClipboard(error.url);
        showToast('保存失败: 已复制链接，可手动下载', 'none');
        return;
      }
      showToast((error && error.message) || '保存失败，请重试', 'none');
    }
  },

  copyAllInfo() {
    const { title, platform, author, cover_url, video_url, video_source_url, music_url, audio_url, images, material_type } = this.data.response;
    const authorName = (author && typeof author === 'object') ? (author.name || '无') : '无';
    const isImageType = material_type === '图文' || material_type === '动图';
    let content = `标题：${title || '无'}\n`;
    content += `平台：${platform || '无'}\n`;
    content += `作者：${authorName}\n`;
    content += `封面：${cover_url || '无'}\n`;
    if (isImageType && Array.isArray(images) && images.length > 0) {
      content += `图集（${images.length}张）：\n${images.map((u, i) => `${i + 1}. ${u}`).join('\n')}\n`;
    } else {
      content += `视频：${video_source_url || video_url || '无'}\n`;
    }
    content += `音频：${music_url || audio_url || '无'}\n`;
    content += `\n【使用声明】上述内容及素材版权均归原平台及创作者所有。请尊重原创，仅供个人学习、赏析使用，严禁用于任何商业牟利或非法用途。`;
    copyToClipboard(content, { title: '全部信息已复制' }).catch(() => {
      this.openCopyPanel(content);
    });
  },

  copyTitle() {
    const { title } = this.data.response;
    let content = `${title || '无'}`;
    copyToClipboard(content, { title: '标题已复制' }).catch(() => {
      this.openCopyPanel(content);
    });
  },

  copyCoverUrl() {
    const { cover_url } = this.data.response;
    let content = `${cover_url || '无'}`;
    copyToClipboard(content, { title: '封面链接已复制' }).catch(() => {
      this.openCopyPanel(content);
    });
  },

  copyVideoUrl() {
    const { video_url, video_source_url, images, material_type } = this.data.response;
    const isImageType = material_type === '图文' || material_type === '动图';
    let content, title;
    if (isImageType && Array.isArray(images) && images.length > 0) {
      // 图文/动图：复制全部图片链接，每行一条
      content = images.join('\n');
      title = `图集链接已复制（共${images.length}张）`;
    } else {
      content = video_source_url || video_url || '无';
      title = '源链已复制';
    }
    copyToClipboard(content, { title }).catch(() => {
      this.openCopyPanel(content);
    });
  },

  showDisclaimer() {
    const content = this.data.disclaimerContent;
    if (!content) return;
    showConfirmModal("去水印说明", content, () => {}, { showCancel: false, confirmText: "确定" });
  },

  onShareAppMessage: function () {
    const { cover_url, title } = this.data.response;
    if (cover_url) {
      return {
        title: truncateString(title, 35) || '发现一个超好用的去水印神器，免费还快！',
        path: '/pages/index/index',
        imageUrl: cover_url,
      };
    }
    return {
      title: '发现一个超好用的去水印神器，免费还快！',
      path: '/pages/index/index',
    };
  },

  openCopyPanel(text) {
    this.setData({
      showCopyPanel: true,
      copyPanelText: text || ''
    });
  },

  closeCopyPanel() {
    this.setData({
      showCopyPanel: false,
      copyPanelText: ''
    });
  },

  onShareTimeline: function () {
    const { cover_url, title } = this.data.response;
    return {
      title: truncateString(title, 35) || '分享一个我一直在用的去水印神器',
      query: 'from=timeline',
      imageUrl: cover_url || '',
    };
  },
  
  navigateToQuestions: function() {
    wx.navigateTo({
      url: '/pages/questions/questions'
    });
  },

  onVideoError: function(e) {
    console.error('Index video error:', e.detail);
    
    // 如果没有重试过，且当前有视频地址，则尝试自动重试一次
    if (!this.data.hasRetried && this.data.response.video_url) {
      console.log('首页视频加载失败，正在尝试自动重试...');
      
      const { response } = this.data;
      const originalUrl = response.video_url;
      const retryUrl = originalUrl.includes('?') 
        ? `${originalUrl}&retry=${Date.now()}` 
        : `${originalUrl}?retry=${Date.now()}`;
      
      this.setData({
        hasRetried: true,
        'response.video_url': retryUrl
      });
    } else {
      // 依然失败则给用户提示
      wx.showToast({
        title: '视频加载不稳定，建议尝试手动保存',
        icon: 'none',
        duration: 2500
      });
    }
  },

  onUnload: function () {
    if (this.innerAudioContext) {
      try { this.innerAudioContext.destroy(); } catch (e) {}
      this.innerAudioContext = null;
    }
  },

});
