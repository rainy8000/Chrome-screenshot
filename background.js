// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  // 处理下载请求
  if (request.action === 'downloadImage') {
    const dataUrl = request.dataUrl;
    const filename = request.filename || '网页截图.png';
    
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: !request.autoSave
    }, function(downloadId) {
      if (chrome.runtime.lastError) {
        sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ status: 'success', downloadId: downloadId });
      }
    });
    
    // 返回true表示将异步发送响应
    return true;
  }
  
  // 处理截取可见区域的请求
  if (request.action === 'captureVisibleTab') {
    chrome.tabs.captureVisibleTab(
      sender.tab.windowId,
      { format: 'png' },
      function(dataUrl) {
        if (chrome.runtime.lastError) {
          sendResponse({ 
            status: 'error', 
            error: chrome.runtime.lastError.message 
          });
        } else {
          sendResponse({ 
            status: 'success', 
            dataUrl: dataUrl 
          });
        }
      }
    );
    
    // 返回true表示将异步发送响应
    return true;
  }
});