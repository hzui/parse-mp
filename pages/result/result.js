import { request } from '../../utils/request';
import { copyToClipboard } from '../../utils/clipboard';
import { truncateString } from '../../utils/util';
import { downloadCoverToPhotosAlbum, downloadVideoToPhotosAlbum, downloadImagesToPhotosAlbum, downloadMixedAlbum } from '../../utils/file';
import { showToast } from '../../utils/ui';

Page({
  data: {
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
    parseResults: [],
    selectedResultIndex: 0,
    showVideo: false,
    showArticle: false,
    showCoverButton: false,
    showSaveCoverButton: false,
    showSaveVideoButton: false,
    showSaveAlbumButton: false,
    audioPlaying: false,
    audioLoading: false,
    showCopyPanel: false,
    copyPanelText: '',
    gifCurrentIndex: 0,
    gifVideoDuration: 0,
    gifVideoProgress: 0,
    gifCurrentTimeStr: '0:00',
    gifDurationStr: '0:00',
    hasRetried: false,
  },

  onLoad(options) {
    const app = getApp();
    const data = app.globalData.parseResult;

    if (data) {
      // 正常流程：从 index 页解析后跳转
      app.globalData.parseResult = null;
      const {
        response, parseResults, selectedResultIndex,
        showVideo, showArticle, showCoverButton,
        showSaveCoverButton, showSaveVideoButton, showSaveAlbumButton
      } = data;
      this.setData({
        response,
        parseResults: parseResults || [],
        selectedResultIndex: selectedResultIndex || 0,
        showVideo: !!showVideo,
        showArticle: !!showArticle,
        showCoverButton: !!showCoverButton,
        showSaveCoverButton: !!showSaveCoverButton,
        showSaveVideoButton: !!showSaveVideoButton,
        showSaveAlbumButton: !!showSaveAlbumButton,
      });
    } else if (options.vid || options.url) {
      // 冷启动：从分享链接进入，通过 URL 参数重建基础结果
      const video_url = options.url ? decodeURIComponent(options.url) : '';
      const cover_url = options.cover ? decodeURIComponent(options.cover) : '';
      const title = options.title ? decodeURIComponent(options.title) : '';
      const video_id = options.vid ? decodeURIComponent(options.vid) : '';
      const material_type = options.mt ? decodeURIComponent(options.mt) : '视频';
      const platform = options.pf ? decodeURIComponent(options.pf) : '';
      const isVideo = material_type === '视频';
      const isDongtu = material_type === '动图';
      const response = {
        video_url, cover_url, title, video_id, platform,
        material_type, images: [], live_video_urls: [],
        music_url: '', music_play_url: '', video_source_url: video_url,
        author: null, share_url: ''
      };
      this.setData({
        response,
        parseResults: [],
        showVideo: isVideo || isDongtu,
        showArticle: !!title,
        showCoverButton: !!cover_url,
        showSaveVideoButton: isVideo,
        showSaveCoverButton: !!cover_url,
        showSaveAlbumButton: false,
      });
    } else {
      // 无任何数据，跳回首页
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }

    this.ensurePlayableGifUrls();
    this.ensurePlayableMusicUrl();
    this.ensurePlayableVideoUrl();
  },

  onUnload() {
    if (this.innerAudioContext) {
      try { this.innerAudioContext.destroy(); } catch (e) {}
      this.innerAudioContext = null;
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
      gifCurrentIndex: 0,
      hasRetried: false,
    });
    this.ensurePlayableVideoUrl();
    this.ensurePlayableGifUrls();
    this.ensurePlayableMusicUrl();
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
        data: { media_type: 'video', video_url, video_id, force_cache: true }
      });
      if (res && res.retcode === 200 && res.data && res.data.download_url) {
        const url = res.data.download_url;
        this.setData({ 'response.video_url': url });
        if (Array.isArray(this.data.parseResults) && this.data.parseResults.length > 0) {
          const idx = this.data.selectedResultIndex || 0;
          const updated = this.data.parseResults.slice();
          if (updated[idx]) {
            updated[idx] = { ...updated[idx], video_url: url };
            this.setData({ parseResults: updated });
          }
        }
      }
    } catch (e) {}
  },

  async ensurePlayableGifUrls() {
    const { live_video_urls, video_id, material_type } = this.data.response || {};
    if (material_type !== '动图') return;
    if (!Array.isArray(live_video_urls) || live_video_urls.length === 0) return;
    const needsProxy = u => this._needsVideoProxy(u);
    if (!live_video_urls.some(needsProxy)) return;
    try {
      const tasks = live_video_urls.map((url, idx) => {
        if (!url) return Promise.resolve({ idx, url: '' });
        if (!needsProxy(url)) return Promise.resolve({ idx, url });
        return request('/api/download', {
          method: 'POST',
          data: { media_type: 'video', video_url: url, video_id: `${video_id}_gif${idx}`, force_cache: true }
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
      const parseResults = this.data.parseResults;
      if (Array.isArray(parseResults) && parseResults.length > 0) {
        const selIdx = this.data.selectedResultIndex || 0;
        const updated = parseResults.slice();
        if (updated[selIdx]) {
          updated[selIdx] = { ...updated[selIdx], live_video_urls: resolvedUrls };
          this.setData({ parseResults: updated });
        }
      }
    } catch (e) {}
  },

  async ensurePlayableMusicUrl() {
    const { music_url, audio_url, video_id } = this.data.response || {};
    const sourceMusicUrl = music_url || audio_url;
    if (!sourceMusicUrl) return;
    this.setData({ audioLoading: true });
    try {
      const res = await request('/api/download', {
        method: 'POST',
        data: { media_type: 'audio', audio_url: sourceMusicUrl, audio_id: video_id, force_cache: true }
      });
      if (res && res.retcode === 200 && res.data && res.data.download_url) {
        const url = res.data.download_url;
        this.setData({ 'response.music_play_url': url });
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
      this.innerAudioContext.onEnded(() => { this.setData({ audioPlaying: false }); });
      this.innerAudioContext.onStop(() => { this.setData({ audioPlaying: false }); });
      this.innerAudioContext.onError(() => { this.setData({ audioPlaying: false }); });
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
    if (Array.isArray(live_video_urls) && live_video_urls[old]) {
      const oldCtx = wx.createVideoContext(`gifVideo${old}`, this);
      if (oldCtx) oldCtx.pause();
    }
    if (Array.isArray(live_video_urls) && live_video_urls[newIndex]) {
      const newCtx = wx.createVideoContext(`gifVideo${newIndex}`, this);
      if (newCtx) newCtx.play();
    }
  },

  onSwiperPrev() {
    const { gifCurrentIndex } = this.data;
    if (gifCurrentIndex > 0) {
      this.setData({ gifCurrentIndex: gifCurrentIndex - 1 });
    }
  },

  onSwiperNext() {
    const { gifCurrentIndex, response } = this.data;
    if (response.images && gifCurrentIndex < response.images.length - 1) {
      this.setData({ gifCurrentIndex: gifCurrentIndex + 1 });
    }
  },

  onGifTimeUpdate(e) {
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
    this.onGifVideoTap(e);
  },

  viewImageAtIndex(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const { cover_url, images, live_photo_urls } = this.data.response;
    const urls = Array.isArray(images) && images.length > 0 ? images : [cover_url];
    const liveUrl = Array.isArray(live_photo_urls) ? (live_photo_urls[index] || '') : '';
    if (liveUrl) {
      const sources = urls.map((imgUrl, i) => {
        const lv = Array.isArray(live_photo_urls) ? (live_photo_urls[i] || '') : '';
        return lv
          ? { url: lv, type: 'video', poster: imgUrl }
          : { url: imgUrl, type: 'image' };
      });
      wx.previewMedia({ sources, current: index });
    } else {
      wx.previewImage({ urls, current: urls[index] || urls[0] });
    }
  },

  viewCoverImage() {
    const { cover_url, images } = this.data.response;
    const urls = Array.isArray(images) && images.length > 0 ? images : [cover_url];
    wx.previewImage({ urls, current: urls[0] });
  },

  async downloadVideo() {
    const { video_url, video_id } = this.data.response;
    try {
      const message = await downloadVideoToPhotosAlbum(video_url, video_id);
      showToast(message, 'success');
    } catch (error) {
      if (error && error.type === 'auth') {
        // 用户取消授权，静默处理
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
          if (!msg.includes('cancel') && !msg.includes('deny') && !msg.includes('authorize') && !msg.includes('permission')) {
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
        const frames = images.map((imgUrl, i) => ({
          imageUrl: imgUrl,
          videoUrl: (live_video_urls[i] || '')
        }));
        const message = await downloadMixedAlbum(frames, video_id);
        showToast(message, 'success');
      } else {
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
    copyToClipboard(title || '无', { title: '标题已复制' }).catch(() => {
      this.openCopyPanel(title || '');
    });
  },

  copyCoverUrl() {
    const { cover_url } = this.data.response;
    copyToClipboard(cover_url || '无', { title: '封面链接已复制' }).catch(() => {
      this.openCopyPanel(cover_url || '');
    });
  },

  copyVideoUrl() {
    const { video_url, video_source_url, images, material_type } = this.data.response;
    const isImageType = material_type === '图文' || material_type === '动图';
    let content, title;
    if (isImageType && Array.isArray(images) && images.length > 0) {
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

  onVideoError(e) {
    console.error('Result video error:', e.detail);
    if (!this.data.hasRetried && this.data.response.video_url) {
      const originalUrl = this.data.response.video_url;
      const retryUrl = originalUrl.includes('?')
        ? `${originalUrl}&retry=${Date.now()}`
        : `${originalUrl}?retry=${Date.now()}`;
      this.setData({ hasRetried: true, 'response.video_url': retryUrl });
    } else {
      wx.showToast({ title: '视频加载不稳定，建议尝试手动保存', icon: 'none', duration: 2500 });
    }
  },

  openCopyPanel(text) {
    this.setData({ showCopyPanel: true, copyPanelText: text || '' });
  },

  closeCopyPanel() {
    this.setData({ showCopyPanel: false, copyPanelText: '' });
  },

  onShareAppMessage() {
    const { cover_url, title } = this.data.response;
    return {
      title: truncateString(title, 35) || '发现一个超好用的去水印神器，免费还快！',
      path: '/pages/index/index',
      imageUrl: cover_url || '',
    };
  },
});
