import { config } from '../../utils/request';
import { showToast } from '../../utils/ui';

const ENDPOINTS = {
  ranking: '/admin/api/ranking_switch',
  moyu: '/admin/api/moyu_switch',
  ad: '/admin/api/ad_switch',
  disclaimer: '/admin/api/disclaimer_switch',
  announcement: '/admin/api/announcement_switch',
  appConfig: '/admin/api/app_config',
  updateConfig: '/admin/api/update_app_config',
  bulkVisibility: '/admin/api/bulk_visibility',
};

Page({
  data: {
    rankingEnabled: false,
    videoPlayEnabled: true,
    autoJumpResult: false,
    allVisible: true,
    moyuEnabled: false,
    moyuApiUrl: '',
    adEnabled: false,
    adUnitId: '',
    discEnabled: true,
    discContent: '',
    annEnabled: false,
    annContent: '',
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '应用配置管理' });
    this._loadAll();
  },

  _header() {
    return { 'WX-OPEN-ID': wx.getStorageSync('openId') || '' };
  },

  _post(endpoint, data, successMsg) {
    wx.request({
      url: `${config.baseURL}${endpoint}`,
      method: 'POST',
      header: { 'Content-Type': 'application/json', ...this._header() },
      data,
      success: r => {
        if (r.data?.success) {
          if (successMsg) showToast(successMsg, 'success');
        } else {
          showToast(r.data?.message || '操作失败', 'none');
        }
      },
      fail: () => showToast('网络错误', 'none'),
    });
  },

  _loadAll() {
    const BASE = config.baseURL;
    const H = this._header();

    // 从 app_config 批量读取系统开关（rankingEnabled、videoPlayEnabled、allVisible）
    wx.request({
      url: `${BASE}${ENDPOINTS.appConfig}`,
      method: 'GET',
      header: H,
      success: r => {
        const rows = Array.isArray(r.data?.data) ? r.data.data : [];
        const cfg = {};
        rows.forEach(row => { cfg[row.config_key] = row.config_value; });
        this.setData({
          rankingEnabled: cfg.ranking_enabled !== '0',
          videoPlayEnabled: cfg.video_play_enabled !== '0',
          autoJumpResult: cfg.auto_jump_result === '1',
          allVisible: cfg.all_visible !== '0',
        });
      },
    });

    wx.request({
      url: `${BASE}${ENDPOINTS.moyu}`,
      method: 'GET',
      header: H,
      success: r => {
        if (r.data?.success) {
          this.setData({
            moyuEnabled: !!r.data.moyu_enabled,
            moyuApiUrl: r.data.moyu_api_url || '',
          });
        }
      },
    });

    wx.request({
      url: `${BASE}${ENDPOINTS.ad}`,
      method: 'GET',
      header: H,
      success: r => {
        if (r.data?.success) {
          this.setData({
            adEnabled: !!r.data.ad_enabled,
            adUnitId: r.data.ad_unit_id || '',
          });
        }
      },
    });

    wx.request({
      url: `${BASE}${ENDPOINTS.disclaimer}`,
      method: 'GET',
      header: H,
      success: r => {
        if (r.data?.success) {
          this.setData({
            discEnabled: !!r.data.disclaimer_enabled,
            discContent: r.data.disclaimer_content || '',
          });
        }
      },
    });

    wx.request({
      url: `${BASE}${ENDPOINTS.announcement}`,
      method: 'GET',
      header: H,
      success: r => {
        if (r.data?.success) {
          this.setData({
            annEnabled: !!r.data.announcement_enabled,
            annContent: r.data.announcement_content || '',
          });
        }
      },
    });
  },

  // ─── 系统配置 ─────────────────────────────────────────────────────────────

  onToggleAutoJump(e) {
    const enabled = e.detail.value;
    this.setData({ autoJumpResult: enabled });
    this._post(ENDPOINTS.updateConfig, { config_key: 'auto_jump_result', config_value: enabled ? '1' : '0' }, enabled ? '跳转结果页已开启' : '跳转结果页已关闭');
  },

  onToggleRanking(e) {
    const enabled = e.detail.value;
    this.setData({ rankingEnabled: enabled });
    this._post(ENDPOINTS.updateConfig, { config_key: 'ranking_enabled', config_value: enabled ? '1' : '0' }, enabled ? '榜单已开启' : '榜单已关闭');
  },

  onToggleVideoPlay(e) {
    const enabled = e.detail.value;
    this.setData({ videoPlayEnabled: enabled });
    this._post(ENDPOINTS.updateConfig, { config_key: 'video_play_enabled', config_value: enabled ? '1' : '0' }, enabled ? '视频播放已开启' : '视频播放已关闭');
  },

  onToggleAllVisible(e) {
    const visible = e.detail.value;
    const title = visible ? '全站上线' : '全站隐身';
    const content = visible ? '将把所有解析记录设为可见，确认继续？' : '将把所有解析记录设为不可见，确认继续？';
    wx.showModal({
      title,
      content,
      confirmText: '确认',
      confirmColor: visible ? '#22c55e' : '#ef4444',
      success: res => {
        if (!res.confirm) {
          // 用户取消，回滚开关状态
          this.setData({ allVisible: !visible });
          return;
        }
        wx.request({
          url: `${config.baseURL}${ENDPOINTS.bulkVisibility}`,
          method: 'POST',
          header: { 'Content-Type': 'application/json', ...this._header() },
          data: { is_visible: visible },
          success: r => {
            if (r.data?.success) {
              this.setData({ allVisible: visible });
              // 同步写入 app_config 以便下次加载时恢复状态
              this._post(ENDPOINTS.updateConfig, { config_key: 'all_visible', config_value: visible ? '1' : '0' });
              showToast(visible ? '全站已上线' : '全站已隐身', 'success');
            } else {
              this.setData({ allVisible: !visible });
              showToast(r.data?.message || '操作失败', 'none');
            }
          },
          fail: () => {
            this.setData({ allVisible: !visible });
            showToast('网络错误', 'none');
          },
        });
      },
      fail: () => {
        this.setData({ allVisible: !visible });
      },
    });
  },

  onToggleMoyu(e) {
    const enabled = e.detail.value;
    this.setData({ moyuEnabled: enabled });
    this._post(ENDPOINTS.moyu, { enabled }, enabled ? '摸鱼已开启' : '摸鱼已关闭');
  },

  onMoyuApiInput(e) {
    this.setData({ moyuApiUrl: e.detail.value });
  },

  saveMoyuApi() {
    this._post(ENDPOINTS.moyu, { moyu_api_url: this.data.moyuApiUrl }, '摸鱼 API 已保存');
  },

  onToggleAd(e) {
    const enabled = e.detail.value;
    this.setData({ adEnabled: enabled });
    this._post(ENDPOINTS.ad, { enabled }, enabled ? '广告已开启' : '广告已关闭');
  },

  onAdUnitInput(e) {
    this.setData({ adUnitId: e.detail.value });
  },

  saveAdUnitId() {
    this._post(ENDPOINTS.ad, { ad_unit_id: this.data.adUnitId }, '广告单元 ID 已保存');
  },

  onToggleDisc(e) {
    const enabled = e.detail.value;
    this.setData({ discEnabled: enabled });
    this._post(ENDPOINTS.disclaimer, { enabled }, enabled ? '免责声明已显示' : '免责声明已隐藏');
  },

  onDiscInput(e) {
    this.setData({ discContent: e.detail.value });
  },

  saveDiscContent() {
    this._post(ENDPOINTS.disclaimer, { content: this.data.discContent }, '免责声明已保存');
  },

  onToggleAnn(e) {
    const enabled = e.detail.value;
    this.setData({ annEnabled: enabled });
    this._post(ENDPOINTS.announcement, { enabled }, enabled ? '公告已开启' : '公告已关闭');
  },

  onAnnInput(e) {
    this.setData({ annContent: e.detail.value });
  },

  saveAnnContent() {
    this._post(ENDPOINTS.announcement, { content: this.data.annContent }, '公告内容已保存');
  },
});
