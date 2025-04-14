document.addEventListener('DOMContentLoaded', function() {
  const captureBtn = document.getElementById('captureBtn');
  const statusDiv = document.getElementById('status');
  const loadingDiv = document.getElementById('loading');
  const progressBarContainer = document.createElement('div');
  const progressBar = document.createElement('div');
  const progressText = document.createElement('div');
  
  // 设置进度条样式
  progressBarContainer.style.width = '100%';
  progressBarContainer.style.backgroundColor = '#f1f1f1';
  progressBarContainer.style.borderRadius = '4px';
  progressBarContainer.style.marginTop = '10px';
  progressBarContainer.style.display = 'none';
  
  progressBar.style.width = '0%';
  progressBar.style.height = '10px';
  progressBar.style.backgroundColor = '#4285f4';
  progressBar.style.borderRadius = '4px';
  progressBar.style.transition = 'width 0.3s';
  
  progressText.style.textAlign = 'center';
  progressText.style.fontSize = '12px';
  progressText.style.marginTop = '5px';
  
  progressBarContainer.appendChild(progressBar);
  progressBarContainer.appendChild(progressText);
  loadingDiv.appendChild(progressBarContainer);
  
  const autoSaveCheckbox = document.getElementById('autoSave');
  const imageFormatSelect = document.getElementById('imageFormat');
  const imageQualitySlider = document.getElementById('imageQuality');
  const qualityValueSpan = document.getElementById('qualityValue');
  
  // 更新质量值显示
  imageQualitySlider.addEventListener('input', function() {
    qualityValueSpan.textContent = this.value;
  });
  
  // 保存设置到本地存储
  function saveSettings() {
    const settings = {
      autoSave: autoSaveCheckbox.checked,
      imageFormat: imageFormatSelect.value,
      imageQuality: imageQualitySlider.value
    };
    chrome.storage.local.set({ settings: settings });
  }
  
  // 从本地存储加载设置
  function loadSettings() {
    chrome.storage.local.get('settings', function(data) {
      if (data.settings) {
        autoSaveCheckbox.checked = data.settings.autoSave;
        imageFormatSelect.value = data.settings.imageFormat;
        imageQualitySlider.value = data.settings.imageQuality;
        qualityValueSpan.textContent = data.settings.imageQuality;
      }
    });
  }
  
  // 尝试加载设置
  loadSettings();
  
  // 当设置改变时保存
  autoSaveCheckbox.addEventListener('change', saveSettings);
  imageFormatSelect.addEventListener('change', saveSettings);
  imageQualitySlider.addEventListener('change', saveSettings);
  
  // 检查页面兼容性
  function checkPageCompatibility() {
    return new Promise((resolve) => {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const currentTab = tabs[0];
        // 检查是否是chrome:// 或 chrome-extension:// 等特殊页面
        if (currentTab.url.startsWith('chrome://') || 
            currentTab.url.startsWith('chrome-extension://') ||
            currentTab.url.startsWith('about:') ||
            currentTab.url.startsWith('chrome-devtools://')) {
          resolve({
            compatible: false,
            reason: '此扩展不能在Chrome内部页面工作'
          });
        } else {
          resolve({ compatible: true });
        }
      });
    });
  }
  
  // 确保content script已加载并可通信
  async function ensureContentScriptLoaded(tabId) {
    try {
      // 首先尝试ping content script看是否已存在
      return await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, {action: 'ping'}, function(response) {
          // 如果没有错误且收到响应，说明content script已加载
          if (chrome.runtime.lastError) {
            // 捕获错误但不显示，我们将尝试注入脚本
            reject(new Error('Content script not loaded'));
          } else if (response && response.pong) {
            resolve(true);
          } else {
            reject(new Error('Content script not responding properly'));
          }
        });
      });
    } catch (error) {
      // 如果ping失败，尝试注入content script
      console.log('Injecting content script...');
      return await chrome.scripting.executeScript({
        target: {tabId: tabId},
        files: ['content.js']
      }).then(() => {
        // 脚本注入后等待一小段时间确保初始化完成
        return new Promise(resolve => setTimeout(() => resolve(true), 200));
      });
    }
  }
  
  // 新增进度消息处理
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'updateProgress') {
      // 显示进度条
      progressBarContainer.style.display = 'block';
      // 更新进度条
      const percent = Math.round(request.progress * 100);
      progressBar.style.width = percent + '%';
      progressText.textContent = percent + '% 完成';
      sendResponse({received: true});
    }
    return true;
  });
  
  captureBtn.addEventListener('click', async function() {
    try {
      // 先检查页面兼容性
      const compatibility = await checkPageCompatibility();
      if (!compatibility.compatible) {
        statusDiv.textContent = compatibility.reason;
        statusDiv.style.color = 'red';
        return;
      }
      
      // 禁用按钮，显示加载状态
      captureBtn.disabled = true;
      statusDiv.textContent = '准备截图...';
      statusDiv.style.color = '#666';
      loadingDiv.style.display = 'block';
      progressBarContainer.style.display = 'block';
      progressBar.style.width = '0%';
      progressText.textContent = '0% 完成';
      
      // 获取当前标签页
      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      if (!tabs || tabs.length === 0) {
        throw new Error('无法获取当前标签页');
      }
      
      const currentTab = tabs[0];
      
      // 确保content script已加载
      await ensureContentScriptLoaded(currentTab.id);
      
      // 获取当前设置
      const settings = {
        autoSave: autoSaveCheckbox.checked,
        imageFormat: imageFormatSelect.value,
        imageQuality: parseInt(imageQualitySlider.value) / 10
      };
      
      // 设置超时处理
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('截图操作超时，请重试')), 60000); // 增加到60秒
      });
      
      // 向当前标签页发送消息，开始截图
      const capturePromise = new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(
          currentTab.id,
          { action: 'captureFullPage', settings: settings },
          function(response) {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            
            if (response && response.status === 'success') {
              resolve(response);
            } else {
              reject(new Error(response ? response.error : '未知错误'));
            }
          }
        );
      });
      
      // 竞态处理超时情况
      const response = await Promise.race([capturePromise, timeoutPromise]);
      
      statusDiv.textContent = '截图完成！';
      progressBar.style.width = '100%';
      progressText.textContent = '100% 完成';
      
      // 如果不是自动保存，则显示截图预览
      if (!settings.autoSave && response.dataUrl) {
        chrome.tabs.create({ url: response.dataUrl });
      }
      
    } catch (error) {
      console.error('截图失败:', error);
      statusDiv.textContent = '截图失败: ' + error.message;
      statusDiv.style.color = 'red';
    } finally {
      // 重置UI状态
      captureBtn.disabled = false;
      // 保留进度条状态，以便用户可以看到结果
    }
  });
});