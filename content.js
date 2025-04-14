// 添加一个限流函数，控制API调用频率
const createRateLimiter = (maxCallsPerSecond) => {
  const queue = [];
  let processing = false;
  
  const processQueue = async () => {
    if (processing || queue.length === 0) return;
    
    processing = true;
    const item = queue.shift();
    
    try {
      const result = await item.fn();
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      processing = false;
      // 等待限流时间后再处理下一个请求
      setTimeout(() => {
        processQueue();
      }, 1000 / maxCallsPerSecond);
    }
  };
  
  return (fn) => {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      processQueue();
    });
  };
};

// 创建截图API的限流器，每秒最多调用1次
const captureRateLimiter = createRateLimiter(1);

// 监听来自popup的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  // 处理ping消息，用于检测content script是否已加载
  if (request.action === 'ping') {
    sendResponse({ pong: true });
    return;
  }
  
  if (request.action === 'captureFullPage') {
    captureFullPage(request.settings)
      .then(function(result) {
        sendResponse(result);
      })
      .catch(function(error) {
        sendResponse({ status: 'error', error: error.message });
      });
    return true; // 表示将异步发送响应
  }
});

// 处理固定定位元素的辅助函数
function handleFixedElements(action) {
  const elementsToManage = [];
  
  // 查找所有固定定位和粘性定位的元素
  const allElements = document.querySelectorAll('*');
  allElements.forEach(el => {
    const style = window.getComputedStyle(el);
    if (style.position === 'fixed' || style.position === 'sticky') {
      // 保存原始状态以便之后恢复
      elementsToManage.push({
        element: el,
        originalPosition: style.position,
        originalTop: style.top,
        originalZIndex: style.zIndex,
        originalDisplay: style.display
      });
      
      if (action === 'hide') {
        // 隐藏固定元素
        el.style.setProperty('display', 'none', 'important');
      } else if (action === 'restore') {
        // 恢复原始状态
        el.style.position = el.dataset.originalPosition || '';
        el.style.top = el.dataset.originalTop || '';
        el.style.zIndex = el.dataset.originalZIndex || '';
        el.style.display = el.dataset.originalDisplay || '';
        
        // 清除数据属性
        el.removeAttribute('data-original-position');
        el.removeAttribute('data-original-top');
        el.removeAttribute('data-original-z-index');
        el.removeAttribute('data-original-display');
      }
    }
  });
  
  // 如果是保存操作，将原始状态保存到数据属性
  if (action === 'save') {
    elementsToManage.forEach(item => {
      const el = item.element;
      el.dataset.originalPosition = item.originalPosition;
      el.dataset.originalTop = item.originalTop;
      el.dataset.originalZIndex = item.originalZIndex; 
      el.dataset.originalDisplay = item.originalDisplay;
    });
  }
  
  return elementsToManage;
}

// 捕获整个页面的函数
async function captureFullPage(settings) {
  try {
    // 保存原始滚动位置
    const originalScrollTop = window.scrollY;
    const originalScrollLeft = window.scrollX;
    
    // 隐藏滚动条以避免截图中包含滚动条
    const originalOverflow = document.documentElement.style.overflow;
    const originalBodyOverflow = document.body.style.overflow;
    
    // 保存固定元素的原始状态
    handleFixedElements('save');
    
    // 获取页面完整尺寸
    const totalHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight,
      document.body.clientHeight,
      document.documentElement.clientHeight
    );
    
    const totalWidth = Math.max(
      document.body.scrollWidth,
      document.documentElement.scrollWidth,
      document.body.offsetWidth,
      document.documentElement.offsetWidth,
      document.body.clientWidth,
      document.documentElement.clientWidth
    );
    
    // 获取视口尺寸
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // 考虑设备像素比
    const pixelRatio = window.devicePixelRatio || 1;
    
    // 创建一个足够大的canvas
    const canvas = document.createElement('canvas');
    canvas.width = totalWidth * pixelRatio;
    canvas.height = totalHeight * pixelRatio;
    const ctx = canvas.getContext('2d');
    
    // 设置canvas比例
    ctx.scale(pixelRatio, pixelRatio);
    
    // 计算需要滚动的次数
    const verticalScrollCount = Math.ceil(totalHeight / viewportHeight);
    const horizontalScrollCount = Math.ceil(totalWidth / viewportWidth);
    
    // 增加延迟时间，确保不会超过API的速率限制
    const SCROLL_DELAY = 500; // 增加到500毫秒
    
    // 计算总截图数量用于进度报告
    const totalCaptures = verticalScrollCount * horizontalScrollCount;
    let captureCount = 0;
    
    // 报告进度的函数
    const reportProgress = (current, total) => {
      const progress = current / total;
      chrome.runtime.sendMessage({
        action: 'updateProgress',
        progress: progress
      });
    };
    
    // 初始进度报告
    reportProgress(0, totalCaptures);
    
    // 逐块截图并绘制到canvas上
    for (let y = 0; y < verticalScrollCount; y++) {
      for (let x = 0; x < horizontalScrollCount; x++) {
        // 滚动到指定位置
        const scrollTop = y * viewportHeight;
        const scrollLeft = x * viewportWidth;
        window.scrollTo(scrollLeft, scrollTop);
        
        // 等待重绘和任何可能的动态加载
        await new Promise(resolve => setTimeout(resolve, SCROLL_DELAY));
        
        // 处理固定元素 - 第一个截图保留固定元素，其他截图隐藏它们
        if (y > 0 || x > 0) {
          handleFixedElements('hide');
        }
        
        // 使用节流机制截取当前可见区域
        const dataUrl = await captureRateLimiter(() => captureVisibleTab());
        const img = await loadImage(dataUrl);
        
        // 计算绘制位置
        const destX = scrollLeft;
        const destY = scrollTop;
        
        // 绘制到canvas上
        ctx.drawImage(img, destX, destY);
        
        // 如果隐藏了固定元素，现在恢复它们
        if (y > 0 || x > 0) {
          handleFixedElements('restore');
        }
        
        // 更新进度
        captureCount++;
        reportProgress(captureCount, totalCaptures);
      }
    }
    
    // 恢复原始滚动位置和溢出样式
    window.scrollTo(originalScrollLeft, originalScrollTop);
    document.documentElement.style.overflow = originalOverflow;
    document.body.style.overflow = originalBodyOverflow;
    
    // 恢复所有固定元素
    handleFixedElements('restore');
    
    // 转换为图片数据
    let imageType = 'image/png';
    let imageQuality = 0.8;
    
    if (settings) {
      if (settings.imageFormat === 'jpeg') {
        imageType = 'image/jpeg';
      }
      if (settings.imageQuality) {
        imageQuality = settings.imageQuality;
      }
    }
    
    const dataUrl = canvas.toDataURL(imageType, imageQuality);
    
    // 如果设置为自动保存，则发送消息给background.js进行下载
    if (settings && settings.autoSave) {
      const filename = document.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.' + settings.imageFormat;
      
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: 'downloadImage',
          dataUrl: dataUrl,
          filename: filename,
          autoSave: settings.autoSave
        }, function(response) {
          if (response && response.status === 'success') {
            resolve({ status: 'success', message: '截图已保存' });
          } else {
            reject(new Error('保存截图失败: ' + (response ? response.error : '未知错误')));
          }
        });
      });
    }
    
    // 返回数据URL
    return { status: 'success', dataUrl: dataUrl };
    
  } catch (error) {
    console.error('截图过程中出错:', error);
    throw error;
  }
}

// 捕获当前可见区域的函数
function captureVisibleTab() {
  return new Promise((resolve, reject) => {
    try {
      // 向background.js发送消息请求截图
      chrome.runtime.sendMessage(
        { action: 'captureVisibleTab' },
        function(response) {
          if (response && response.status === 'success') {
            resolve(response.dataUrl);
          } else {
            reject(new Error('截取可见区域失败: ' + (response ? response.error : '未知错误')));
          }
        }
      );
    } catch (error) {
      console.error('截取可见区域失败:', error);
      reject(error);
    }
  });
}

// 加载图片的辅助函数
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = function() {
      resolve(img);
    };
    img.onerror = function() {
      reject(new Error('加载图片失败'));
    };
    img.src = dataUrl;
  });
}