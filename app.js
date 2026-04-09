import config from './utils/config';

App({
  async onLaunch() {
    console.log('App launched');

    if (wx.onNeedPrivacyAuthorization) {
      wx.onNeedPrivacyAuthorization((resolve) => {
        wx.showModal({
          title: '隐私保护提示',
          content: '为实现复制/粘贴等功能，需要你阅读并同意《隐私保护指引》。',
          confirmText: '去同意',
          cancelText: '暂不',
          success: (res) => {
            if (res.confirm && wx.openPrivacyContract) {
              wx.openPrivacyContract({
                success: () => resolve({ buttonId: 1 }),
                fail: () => resolve({ buttonId: 0 })
              });
              return;
            }
            resolve({ buttonId: res.confirm ? 1 : 0 });
          },
          fail: () => resolve({ buttonId: 0 })
        });
      });
    }

    await this.autoLogin();
  },

  async autoLogin() {
    // 已有登录态直接复用
    const cachedOpenId = wx.getStorageSync('openId');
    if (cachedOpenId) {
      this.globalData.openId = cachedOpenId;
      this.globalData.userInfo = wx.getStorageSync('userInfo') || null;
      return;
    }

    try {
      const loginRes = await new Promise((resolve, reject) => {
        wx.login({
          success: resolve,
          fail: reject,
        });
      });

      const code = loginRes && loginRes.code;
      if (!code) return;

      const data = await new Promise((resolve, reject) => {
        wx.request({
          url: `${config.baseURL}/api/login`,
          method: 'POST',
          data: { code },
          success: (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(res.data || {});
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          },
          fail: reject,
        });
      });

      if (!data || !data.openid) return;

      const userInfo = {
        nickname: data.nickname || '',
        avatar: data.avatar_url || '',
      };

      wx.setStorageSync('openId', data.openid);
      wx.setStorageSync('isAdmin', !!data.is_admin);
      wx.setStorageSync('userInfo', userInfo);

      this.globalData.openId = data.openid;
      this.globalData.userInfo = userInfo;
    } catch (e) {
      console.warn('autoLogin failed:', e);
      // 自动登录失败不阻断页面流程
    }
  },

  globalData: {
    userInfo: null,
    openId: ''
  }
});

