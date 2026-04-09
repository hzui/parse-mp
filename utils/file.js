import { request } from './request';
import { copyToClipboard } from './clipboard';
import { showToast } from './ui';


// 下载封面并保存到相册
// 功能：将指定 URL 的图片下载并保存到用户的手机相册
function downloadCoverToPhotosAlbum(url, showLoading = false, errorCallback = () => {}) {
  if (showLoading) {
    wx.showLoading({
      title: '下载中...',
      mask: true
    });
  }
  wx.downloadFile({
    url: url,
    success: (res) => {
      const filePath = res.tempFilePath;
      wx.saveImageToPhotosAlbum({
        filePath: filePath,
        success: () => {
          if (showLoading) {
            wx.hideLoading();
          }
          wx.showToast({
            title: '封面保存成功',
            icon: 'success'
          });
        },
        fail: (err) => {
          if (showLoading) {
            wx.hideLoading();
          }
          console.error('保存封面失败:', err);
          errorCallback(err);
        }
      });
    },
    fail: (err) => {
      if (showLoading) {
        wx.hideLoading();
      }
      console.error('下载封面失败:', err);
      errorCallback(err);
    }
  });
}

// 下载视频到相册
// 功能：将指定视频下载并保存到用户的手机相册，返回一个 Promise 对象
function downloadVideoToPhotosAlbum(videoUrl, videoId) {
  return new Promise((resolve, reject) => {
    // 显示加载提示
    wx.showLoading({
      title: '正在下载...',
    });
    request('/api/download', {
      method: 'POST',
      data: {
        video_url: videoUrl,
        video_id: videoId
      }
    }).then(res => {
      console.info('Request Response:', res); // 打印请求响应
      if (res.retcode === 200) {
        const downloadUrl = res.data.download_url;
        console.info('downloadUrl', downloadUrl);
        // 开始下载文件
        const downloadTask = wx.downloadFile({
          url: downloadUrl,
          success: (res) => {
            console.info('Download Response:', res); // 打印下载响应
            if (res.statusCode === 200) {
              const filePath = res.tempFilePath;
              // 保存视频到相册
              wx.saveVideoToPhotosAlbum({
                filePath: filePath,
                success: () => {
                  wx.hideLoading(); // 隐藏加载提示
                  resolve('视频保存成功');
                },
                fail: (err) => {
                  wx.hideLoading();
                  const msg = err.errMsg || '';
                  if (msg.includes('cancel') || msg.includes('deny') || msg.includes('authorize') || msg.includes('permission')) {
                    reject({ type: 'auth', message: '需要相册权限才能保存视频' });
                  } else {
                    reject({ type: 'save', message: '保存到相册失败: ' + msg });
                  }
                }
              });
            } else {
              wx.hideLoading(); // 隐藏加载提示
              reject('下载失败');
            }
          },
          fail: (err) => {
            wx.hideLoading(); // 隐藏加载提示
            reject('下载失败: ' + err.errMsg);
          }
        });
        // 监听下载进度（不需要具体百分比，可以不处理）
        downloadTask.onProgressUpdate((res) => {
          // 这里可以不处理进度信息，只显示一个加载中的提示
        });
      } else {
        wx.hideLoading(); // 隐藏加载提示
        reject('请求失败');
      }
    }).catch(err => {
      wx.hideLoading(); // 隐藏加载提示
      console.info('Request Error:', err); // 打印请求错误
      reject('请求失败');
    });
  });
}

function downloadImagesToPhotosAlbum(urls) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(urls) || urls.length === 0) {
      reject({ message: '无可保存的图片' });
      return;
    }

    let index = 0;

    const downloadAndSave = () => {
      const url = urls[index];
      wx.showLoading({
        title: `保存中 ${index + 1}/${urls.length}`,
        mask: true
      });
      wx.downloadFile({
        url,
        success: (res) => {
          if (res.statusCode !== 200) {
            wx.hideLoading();
            reject({ message: '下载失败', url });
            return;
          }
          wx.saveImageToPhotosAlbum({
            filePath: res.tempFilePath,
            success: () => {
              index += 1;
              if (index >= urls.length) {
                wx.hideLoading();
                resolve('图集保存成功');
                return;
              }
              downloadAndSave();
            },
            fail: (err) => {
              wx.hideLoading();
              reject({ message: err.errMsg || '保存失败', url });
            }
          });
        },
        fail: (err) => {
          wx.hideLoading();
          reject({ message: err.errMsg || '下载失败', url });
        }
      });
    };

    downloadAndSave();
  });
}


// 混合图集保存：图文帧保存图片，动图帧保存视频（通过服务端代理下载）
// frames: [{ imageUrl, videoUrl }]，videoUrl 为空串表示纯静态帧
function downloadMixedAlbum(frames, videoId) {
  return new Promise((resolve, reject) => {
    if (!Array.isArray(frames) || frames.length === 0) {
      reject({ message: '无可保存的内容' });
      return;
    }

    let index = 0;
    let savedCount = 0;

    const saveNext = () => {
      if (index >= frames.length) {
        wx.hideLoading();
        resolve(`已保存 ${savedCount}/${frames.length} 项`);
        return;
      }

      const { imageUrl, videoUrl } = frames[index];
      const frameIndex = index;
      index += 1;
      wx.showLoading({ title: `保存中 ${frameIndex + 1}/${frames.length}`, mask: true });

      if (videoUrl) {
        // 动图帧：先通过服务端代理获取可下载地址，再保存为视频
        const { request } = require('./request');
        request('/api/download', {
          method: 'POST',
          data: { media_type: 'video', video_url: videoUrl, video_id: `${videoId}_gif${frameIndex}`, force_cache: true }
        }).then(res => {
          const dlUrl = res && res.retcode === 200 && res.data && res.data.download_url
            ? res.data.download_url : videoUrl;
          wx.downloadFile({
            url: dlUrl,
            success: (dlRes) => {
              if (dlRes.statusCode !== 200) { wx.hideLoading(); reject({ message: `第${frameIndex + 1}帧下载失败`, url: videoUrl }); return; }
              wx.saveVideoToPhotosAlbum({
                filePath: dlRes.tempFilePath,
                success: () => { savedCount++; saveNext(); },
                fail: (err) => { wx.hideLoading(); reject({ message: err.errMsg || '保存视频失败', url: videoUrl }); }
              });
            },
            fail: (err) => { wx.hideLoading(); reject({ message: err.errMsg || '下载失败', url: videoUrl }); }
          });
        }).catch(() => { wx.hideLoading(); reject({ message: `第${frameIndex + 1}帧请求失败`, url: videoUrl }); });
      } else {
        // 图文帧：直接保存图片
        wx.downloadFile({
          url: imageUrl,
          success: (dlRes) => {
            if (dlRes.statusCode !== 200) { wx.hideLoading(); reject({ message: `第${frameIndex + 1}帧下载失败`, url: imageUrl }); return; }
            wx.saveImageToPhotosAlbum({
              filePath: dlRes.tempFilePath,
              success: () => { savedCount++; saveNext(); },
              fail: (err) => { wx.hideLoading(); reject({ message: err.errMsg || '保存图片失败', url: imageUrl }); }
            });
          },
          fail: (err) => { wx.hideLoading(); reject({ message: err.errMsg || '下载失败', url: imageUrl }); }
        });
      }
    };

    saveNext();
  });
}


// 功能：统一处理文件下载错误，打印错误信息并复制链接
function handleDownloadError(error, url, type) {
  console.error(`${type}下载失败:`, error);
  copyToClipboard(url);
        showToast(`下载失败: ${type}地址已复制，您可以尝试手动下载`, 'none');
}

export { downloadCoverToPhotosAlbum, downloadVideoToPhotosAlbum, downloadImagesToPhotosAlbum, downloadMixedAlbum, handleDownloadError };
