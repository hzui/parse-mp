import config from './config.js';
import { generateComplexText, vigenereEncrypt, timestampToLetters } from './util.js';

// 请求工具函数
function request(url, options = {}, retryCount = 0) {
  return new Promise((resolve, reject) => {
    // 处理URL，如果不是完整URL则添加baseURL
    const fullUrl = url.startsWith('http') ? url : `${config.baseURL}${url}`;
    
    // 自动注入 WX-OPEN-ID（所有请求）
    const header = options.header || {};
    if (!header['WX-OPEN-ID']) {
      const openId = wx.getStorageSync('openId');
      if (openId) header['WX-OPEN-ID'] = openId;
    }

    // 构造加密头 (针对 parse 和 download 接口)
    if (url.includes('/api/parse') || url.includes('/api/download') || url.includes('/api/records') || url.includes('/api/upload_userinfo') || url.includes('/api/get_userinfo') || url.includes('/api/stats')) {
      const timestamp = Date.now().toString();
      const originalText = generateComplexText();
      const key = timestampToLetters(timestamp);
      const encryptedText = vigenereEncrypt(originalText, key);
      
      header['X-Timestamp'] = timestamp;
      header['X-GCLT-Text'] = originalText;
      header['X-EGCT-Text'] = encryptedText;
    }
    
    // 超时处理
    const timeoutId = setTimeout(() => {
      reject(new Error('请求超时'));
    }, options.timeout || config.timeout);
    
    // 创建请求任务
    const requestTask = wx.request({
      url: fullUrl,
      ...options,
      header: header,
      success: (res) => {
        clearTimeout(timeoutId);
        
        // 统一处理HTTP状态码
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 处理业务状态码
          // 兼容后端返回格式：有的接口直接返回数据，有的包裹在 data 中
          const responseData = res.data;
          if (responseData && (responseData.retcode === 200 || responseData.code === 200 || responseData.success === true)) {
             resolve(responseData);
          } else {
             // 如果后端返回了具体的错误信息，优先使用
             const errorMsg = responseData && (responseData.retdesc || responseData.msg || responseData.message) || '请求失败';
             reject(new Error(errorMsg));
          }
        } else {
          // HTTP 错误状态码
          const responseData = res.data;
          const errorMsg =
            (responseData && (responseData.retdesc || responseData.msg || responseData.message)) ||
            `HTTP错误: ${res.statusCode}`;
          reject(new Error(errorMsg));
        }
      },
      fail(err) {
        clearTimeout(timeoutId);
        
        // 重试逻辑
        if (retryCount < config.maxRetries) {
          console.log(`请求失败，正在重试... (${retryCount + 1}/${config.maxRetries})`);
          resolve(request(url, options, retryCount + 1));
        } else {
          reject(new Error(`请求失败: ${err.errMsg || '未知错误'}`));
        }
      },
      complete() {
        clearTimeout(timeoutId);
      }
    });
    
    // 保存请求任务，允许外部取消
    requestTask.cancel = () => {
      clearTimeout(timeoutId);
      requestTask.abort();
      reject(new Error('请求已取消'));
    };
  });
};

export { request, config };
