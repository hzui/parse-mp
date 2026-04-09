Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: '/pages/index/index',
        text: '喵去水印',
        icon: '/images/home.png',
        activeIcon: '/images/home-active.png',
      },
      {
        pagePath: '/pages/moyu/moyu',
        text: '摸鱼日报',
        icon: '/images/ranking.png',
        activeIcon: '/images/ranking-active.png',
      },
      {
        pagePath: '/pages/profile/profile',
        text: '个人中心',
        icon: '/images/user.png',
        activeIcon: '/images/user-active.png',
      },
    ],
  },

  methods: {
    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      wx.switchTab({ url: item.pagePath });
      this.setData({ selected: index });
    },
  },
});
