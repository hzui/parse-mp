import { truncateString } from '../../utils/util';

Page({
  data: {
    videoUrl: '',
    coverUrl: '',
    title: '',
    videoId: '',
    platform: '',
    materialType: '',
    shareUrl: '',
  },

  onLoad(options) {
    const { url, cover, title, vid, pf, mt, share_url } = options;
    this.setData({
      videoUrl:     url        ? decodeURIComponent(url)        : '',
      coverUrl:     cover      ? decodeURIComponent(cover)      : '',
      title:        title      ? decodeURIComponent(title)      : '',
      videoId:      vid        ? decodeURIComponent(vid)        : '',
      platform:     pf         ? decodeURIComponent(pf)         : '',
      materialType: mt         ? decodeURIComponent(mt)         : '',
      shareUrl:     share_url  ? decodeURIComponent(share_url)  : '',
    });
  },

  // 跳首页并预填分享链接（让用户一键解析同款）
  goParseNow() {
    const app = getApp();
    app.globalData.prefillUrl = this.data.shareUrl || '';
    wx.switchTab({ url: '/pages/index/index' });
  },

  // 跳 videoPlayer 全屏播放
  watchVideo() {
    const { videoUrl, coverUrl, title, videoId } = this.data;
    wx.navigateTo({
      url: `/pages/videoPlayer/videoPlayer?url=${encodeURIComponent(videoUrl)}&` +
           `cover=${encodeURIComponent(coverUrl)}&` +
           `title=${encodeURIComponent(title)}&` +
           `videoid=${encodeURIComponent(videoId)}`
    });
  },

  onShareAppMessage() {
    const { coverUrl, title } = this.data;
    return {
      title: truncateString(title, 35) || '发现一个超好用的去水印神器，免费还快！',
      path: '/pages/index/index',
      imageUrl: coverUrl || '',
    };
  },
});
